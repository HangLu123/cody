import { type Configuration, FeatureFlag, type FeatureFlagProvider } from '@sourcegraph/cody-shared'
import type { ContextStrategy } from './context/context-strategy'

class CompletionProviderConfig {
    private _config?: Configuration

    /**
     * Use the injected feature flag provider to make testing easier.
     */
    private featureFlagProvider?: FeatureFlagProvider

    private flagsToResolve = [
        FeatureFlag.CodyAutocompleteContextBfgMixed,
        FeatureFlag.CodyAutocompleteHotStreak,
        FeatureFlag.CodyAutocompleteUserLatency,
        FeatureFlag.CodyAutocompleteTracing,
        FeatureFlag.CodyAutocompleteContextExtendLanguagePool,
        FeatureFlag.CodyAutocompleteSmartThrottle,
        FeatureFlag.CodyAutocompleteLatencyExperimentBasedFeatureFlag,
    ] as const

    private get config() {
        if (!this._config) {
            throw new Error('CompletionProviderConfig is not initialized')
        }

        return this._config
    }

    /**
     * Should be called before `InlineCompletionItemProvider` instance is created, so that the singleton
     * with resolved values is ready for downstream use.
     */
    public async init(config: Configuration, featureFlagProvider: FeatureFlagProvider): Promise<void> {
        this._config = config
        this.featureFlagProvider = featureFlagProvider

        await Promise.all(this.flagsToResolve.map(flag => featureFlagProvider.evaluateFeatureFlag(flag)))
    }

    public setConfig(config: Configuration) {
        this._config = config
    }

    public getPrefetchedFlag(flag: (typeof this.flagsToResolve)[number]): boolean {
        if (!this.featureFlagProvider) {
            throw new Error('CompletionProviderConfig is not initialized')
        }

        return Boolean(this.featureFlagProvider.getFromCache(flag as FeatureFlag))
    }

    public get contextStrategy(): ContextStrategy {
        switch (this.config.autocompleteExperimentalGraphContext as string) {
            case 'lsp-light':
                return 'lsp-light'
            case 'tsc-mixed':
                return 'tsc-mixed'
            case 'tsc':
                return 'tsc'
            case 'bfg':
                return 'bfg'
            case 'bfg-mixed':
                return 'bfg-mixed'
            case 'jaccard-similarity':
                return 'jaccard-similarity'
            case 'new-jaccard-similarity':
                return 'new-jaccard-similarity'
            default:
                return this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteContextBfgMixed)
                    ? 'bfg-mixed'
                    : 'jaccard-similarity'
        }
    }

    private getLatencyExperimentGroup(): 'hot-streak' | 'smart-throttle' | 'control' {
        // The desired distribution:
        // - Hot-streak 33%
        // - Smart-throttle 33%
        // - Control group 33%
        //
        // The rollout values to set;
        // - CodyAutocompleteLatencyExperimentBasedFeatureFlag 66%
        // - CodyAutocompleteHotStreak 50%
        // - CodyAutocompleteSmartThrottle 100%
        if (this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteLatencyExperimentBasedFeatureFlag)) {
            if (this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteHotStreak)) {
                return 'hot-streak'
            }

            if (this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteSmartThrottle)) {
                return 'smart-throttle'
            }
        }

        return 'control'
    }

    public get hotStreak(): boolean {
        return (
            this.config.autocompleteExperimentalHotStreak ||
            this.getLatencyExperimentGroup() === 'hot-streak'
        )
    }

    public get smartThrottle(): boolean {
        return (
            this.config.autocompleteExperimentalSmartThrottle ||
            this.getLatencyExperimentGroup() === 'smart-throttle'
        )
    }
}

/**
 * A singleton store for completion provider configuration values which allows us to
 * avoid propagating every feature flag and config value through completion provider
 * internal calls. It guarantees that `flagsToResolve` are resolved on `CompletionProvider`
 * creation and along with `Configuration`.
 *
 * A subset of relevant config values and feature flags is moved here from the existing
 * params waterfall. Ideally, we rely on this singleton as a source of truth for config values
 * and collapse function calls nested in `InlineCompletionItemProvider.generateCompletions()`.
 */
export const completionProviderConfig = new CompletionProviderConfig()
