import * as vscode from 'vscode'

import {
    type AuthStatus,
    type AuthStatusProvider,
    CodyIDE,
    type ConfigurationWithAccessToken,
    DOTCOM_URL,
    LOCAL_APP_URL,
    SourcegraphGraphQLAPIClient,
    defaultAuthStatus,
    isError,
    logError,
    networkErrorAuthStatus,
    offlineModeAuthStatus,
    telemetryRecorder,
    unauthenticatedStatus,
} from '@sourcegraph/cody-shared'

import { AccountMenuOptions, openAccountMenu } from '../auth/account-menu'
import { closeAuthProgressIndicator } from '../auth/auth-progress-indicator'
import { CodyChatPanelViewType } from '../chat/chat-view/ChatManager'
import { ACCOUNT_USAGE_URL, isLoggedIn as isAuthenticated, isSourcegraphToken } from '../chat/protocol'
import { newAuthStatus } from '../chat/utils'
import { getFullConfig } from '../configuration'
import { logDebug } from '../log'
import { maybeStartInteractiveTutorial } from '../tutorial/helpers'
import { AuthMenu, showAccessTokenInputBox, showInstanceURLInputBox } from './AuthMenus'
import { getAuthReferralCode } from './AuthProviderSimplified'
import { localStorage } from './LocalStorageProvider'
import { secretStorage } from './SecretStorageProvider'

type Listener = (authStatus: AuthStatus) => void
type Unsubscribe = () => void

const HAS_AUTHENTICATED_BEFORE_KEY = 'has-authenticated-before'

type AuthConfig = Pick<ConfigurationWithAccessToken, 'serverEndpoint' | 'accessToken' | 'customHeaders'>
export class AuthProvider implements AuthStatusProvider {
    private endpointHistory: string[] = []

    private client: SourcegraphGraphQLAPIClient | null = null

    private authStatus: AuthStatus = defaultAuthStatus
    private listeners: Set<Listener> = new Set()

    static create(config: AuthConfig) {
        if (!authProvider) {
            authProvider = new AuthProvider(config)
        }
        return authProvider
    }

    private constructor(private config: AuthConfig) {
        this.authStatus.endpoint = 'init'
        this.loadEndpointHistory()
    }

    // Sign into the last endpoint the user was signed into, if any
    public async init(): Promise<void> {
        let lastEndpoint = localStorage?.getEndpoint() || this.config.serverEndpoint
        let token = (await secretStorage.get(lastEndpoint || '')) || this.config.accessToken
        logDebug(
            'AuthProvider:init:lastEndpoint',
            token?.trim() ? 'Token recovered from secretStorage' : 'No token found in secretStorage',
            lastEndpoint
        )
        if (lastEndpoint === LOCAL_APP_URL.toString()) {
            // If the user last signed in to app, which talks to dotcom, try
            // signing them in to dotcom.
            logDebug('AuthProvider:init', 'redirecting App-signed in user to dotcom')
            lastEndpoint = DOTCOM_URL.toString()
            token = (await secretStorage.get(lastEndpoint)) || null
        }

        await this.auth({
            endpoint: lastEndpoint,
            token: token || null,
            isExtensionStartup: true,
        }).catch(error => logError('AuthProvider:init:failed', lastEndpoint, { verbose: error }))
    }

    public addChangeListener(listener: Listener): Unsubscribe {
        listener(this.authStatus)
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    // Display quickpick to select endpoint to sign in to
    public async signinMenu(type?: 'enterprise' | 'dotcom' | 'token', uri?: string): Promise<void> {
        const mode = this.authStatus.isLoggedIn ? 'switch' : 'signin'
        logDebug('AuthProvider:signinMenu', mode)
        telemetryRecorder.recordEvent('cody.auth.login', 'clicked')
        const item = await AuthMenu(mode, this.endpointHistory)
        if (!item) {
            return
        }
        const menuID = type || item?.id
        telemetryRecorder.recordEvent('cody.auth.signin.menu', 'clicked', {
            privateMetadata: { menuID },
        })
        switch (menuID) {
            case 'enterprise': {
                const instanceUrl = await showInstanceURLInputBox(item.uri)
                if (!instanceUrl) {
                    return
                }
                this.authStatus.endpoint = instanceUrl
                this.redirectToEndpointLogin(instanceUrl)
                break
            }
            case 'dotcom':
                this.redirectToEndpointLogin(DOTCOM_URL.href)
                break
            case 'token': {
                const instanceUrl = await showInstanceURLInputBox(uri || item.uri)
                if (!instanceUrl) {
                    return
                }
                await this.signinMenuForInstanceUrl(instanceUrl)
                break
            }
            default: {
                // Auto log user if token for the selected instance was found in secret
                const selectedEndpoint = item.uri
                const token = await secretStorage.get(selectedEndpoint)
                let authStatus = await this.auth({
                    endpoint: selectedEndpoint,
                    token: token || null,
                })
                if (!authStatus?.isLoggedIn) {
                    const newToken = await showAccessTokenInputBox(item.uri)
                    if (!newToken) {
                        return
                    }
                    authStatus = await this.auth({
                        endpoint: selectedEndpoint,
                        token: newToken || null,
                    })
                }
                await showAuthResultMessage(selectedEndpoint, authStatus?.authStatus)
                logDebug('AuthProvider:signinMenu', mode, selectedEndpoint)
            }
        }
    }

    private async signinMenuForInstanceUrl(instanceUrl: string): Promise<void> {
        const accessToken = await showAccessTokenInputBox(instanceUrl)
        if (!accessToken) {
            return
        }
        const authState = await this.auth({
            endpoint: instanceUrl,
            token: accessToken,
        })
        telemetryRecorder.recordEvent('cody.auth.signin.token', 'clicked', {
            metadata: {
                success: authState?.isLoggedIn ? 1 : 0,
            },
        })
        await showAuthResultMessage(instanceUrl, authState?.authStatus)
    }

    public async signoutMenu(): Promise<void> {
        telemetryRecorder.recordEvent('cody.auth.logout', 'clicked')
        const { endpoint } = this.getAuthStatus()

        if (endpoint) {
            await this.signout(endpoint)
            logDebug('AuthProvider:signoutMenu', endpoint)
        }
    }

    public async accountMenu(): Promise<void> {
        const selected = await openAccountMenu(this.authStatus)
        if (selected === undefined) {
            return
        }

        switch (selected) {
            case AccountMenuOptions.Manage: {
                // Add the username to the web can warn if the logged in session on web is different from VS Code
                const uri = vscode.Uri.parse(ACCOUNT_USAGE_URL.toString()).with({
                    query: `cody_client_user=${encodeURIComponent(this.authStatus.username)}`,
                })
                void vscode.env.openExternal(uri)
                break
            }
            case AccountMenuOptions.Switch:
                await this.signinMenu()
                break
            case AccountMenuOptions.SignOut:
                await this.signoutMenu()
                break
        }
    }

    // Log user out of the selected endpoint (remove token from secret)
    private async signout(endpoint: string): Promise<void> {
        await secretStorage.deleteToken(endpoint)
        await localStorage.deleteEndpoint()
        await this.auth({ endpoint, token: null })
        this.authStatus.endpoint = ''
        await vscode.commands.executeCommand('setContext', CodyChatPanelViewType, false)
        await vscode.commands.executeCommand('setContext', 'cody.activated', false)
    }

    // Create Auth Status
    private async makeAuthStatus(
        config: Pick<ConfigurationWithAccessToken, 'serverEndpoint' | 'accessToken' | 'customHeaders'>,
        isOfflineMode?: boolean
    ): Promise<AuthStatus> {
        const endpoint = config.serverEndpoint
        const token = config.accessToken
        const isCodyWeb =
            vscode.workspace.getConfiguration().get<string>('cody.advanced.agent.ide') === CodyIDE.Web

        if (isOfflineMode) {
            const lastUser = localStorage.getLastStoredUser()
            return { ...offlineModeAuthStatus, ...lastUser }
        }

        // Cody Web can work without access token since authorization flow
        // relies on cookie authentication
        if (isCodyWeb) {
            if (!endpoint) {
                return { ...defaultAuthStatus, endpoint }
            }
        } else {
            if (!token || !endpoint) {
                return { ...defaultAuthStatus, endpoint }
            }
        }
        // Cache the config and the GraphQL client
        if (this.config !== config || !this.client) {
            this.config = config
            this.client = new SourcegraphGraphQLAPIClient(config)
        }
        // Version is for frontend to check if Cody is not enabled due to unsupported version when siteHasCodyEnabled is false
        const [{ enabled, version }, codyLLMConfiguration, userInfo] = await Promise.all([
            this.client.isCodyEnabled(),
            this.client.getCodyLLMConfiguration(),
            this.client.getCurrentUserInfo(),
        ])

        const configOverwrites = isError(codyLLMConfiguration) ? undefined : codyLLMConfiguration

        const isDotCom = this.client.isDotCom()

        if (!isDotCom) {
            const hasVerifiedEmail = false

            // check first if it's a network error
            if (isError(userInfo)) {
                if (isNetworkError(userInfo)) {
                    return { ...networkErrorAuthStatus, endpoint }
                }
                return { ...unauthenticatedStatus, endpoint }
            }

            return newAuthStatus(
                endpoint,
                isDotCom,
                !isError(userInfo),
                hasVerifiedEmail,
                enabled,
                /* userCanUpgrade: */ false,
                version,
                userInfo.avatarURL,
                userInfo.username,
                userInfo.displayName,
                userInfo.primaryEmail?.email,
                configOverwrites
            )
        }

        // Configure AuthStatus for DotCom users
        const isCodyEnabled = true

        // check first if it's a network error
        if (isError(userInfo)) {
            if (isNetworkError(userInfo)) {
                return { ...networkErrorAuthStatus, endpoint }
            }
            return { ...unauthenticatedStatus, endpoint }
        }

        const proStatus = await this.client.getCurrentUserCodySubscription()
        // Pro user without the pending status is the valid pro users
        const isActiveProUser =
            'plan' in proStatus && proStatus.plan === 'PRO' && proStatus.status !== 'PENDING'

        return newAuthStatus(
            endpoint,
            isDotCom,
            !!userInfo.id,
            userInfo.hasVerifiedEmail,
            isCodyEnabled,
            !isActiveProUser, // UserCanUpgrade
            version,
            userInfo.avatarURL,
            userInfo.username,
            userInfo.displayName,
            userInfo.primaryEmail?.email,
            configOverwrites,
            userInfo.organizations
        )
    }

    public getAuthStatus(): AuthStatus {
        return this.authStatus
    }

    // It processes the authentication steps and stores the login info before sharing the auth status with chatview
    public async auth({
        endpoint,
        token,
        customHeaders,
        isExtensionStartup = false,
        isOfflineMode = false,
    }: {
        endpoint: string
        token: string | null
        customHeaders?: Record<string, string> | null
        isExtensionStartup?: boolean
        isOfflineMode?: boolean
    }): Promise<{ authStatus: AuthStatus; isLoggedIn: boolean }> {
        const config = {
            serverEndpoint: formatURL(endpoint) ?? '',
            accessToken: token,
            customHeaders: customHeaders || this.config.customHeaders,
        }

        try {
            const authStatus = await this.makeAuthStatus(config, isOfflineMode)
            const isLoggedIn = isAuthenticated(authStatus)
            authStatus.isLoggedIn = isLoggedIn

            if (!isOfflineMode) {
                await this.storeAuthInfo(config.serverEndpoint, config.accessToken)
            }

            this.syncAuthStatus(authStatus)
            await vscode.commands.executeCommand('setContext', 'cody.activated', isLoggedIn)

            // If the extension is authenticated on startup, it can't be a user's first
            // ever authentication. We store this to prevent logging first-ever events
            // for already existing users.
            if (isExtensionStartup && isLoggedIn) {
                await this.setHasAuthenticatedBefore()
            } else if (isLoggedIn) {
                this.handleFirstEverAuthentication()
            }

            return { authStatus, isLoggedIn }
        } catch (error) {
            logDebug('AuthProvider:auth', 'failed', error)

            // Try to reload auth status in case of network error, else return default auth status
            return await this.reloadAuthStatus().catch(() => {
                return { authStatus: unauthenticatedStatus, isLoggedIn: false }
            })
        }
    }

    // Set auth status in case of reload
    public async reloadAuthStatus(): Promise<{ authStatus: AuthStatus; isLoggedIn: boolean }> {
        await vscode.commands.executeCommand('setContext', 'cody.activated', false)

        this.config = await getFullConfig()
        return await this.auth({
            endpoint: this.config.serverEndpoint,
            token: this.config.accessToken,
            customHeaders: this.config.customHeaders,
        })
    }

    // Set auth status and share it with chatview
    private syncAuthStatus(authStatus: AuthStatus): void {
        if (this.authStatus === authStatus) {
            return
        }
        this.authStatus = authStatus
        this.announceNewAuthStatus()
    }

    public announceNewAuthStatus(): void {
        if (this.authStatus.endpoint === 'init') {
            return
        }
        const authStatus = this.getAuthStatus()
        for (const listener of this.listeners) {
            listener(authStatus)
        }
    }

    // Register URI Handler (vscode://sourcegraph.cody-ai) for resolving token
    // sending back from sourcegraph.com
    public async tokenCallbackHandler(
        uri: vscode.Uri,
        customHeaders: Record<string, string>
    ): Promise<void> {
        closeAuthProgressIndicator()

        const params = new URLSearchParams(uri.query)
        const token = params.get('code')
        const endpoint = this.authStatus.endpoint
        if (!token || !endpoint) {
            return
        }
        const authState = await this.auth({ endpoint, token, customHeaders })
        telemetryRecorder.recordEvent('cody.auth.fromCallback.web', 'succeeded', {
            metadata: {
                success: authState?.isLoggedIn ? 1 : 0,
            },
        })
        if (authState?.isLoggedIn) {
            await vscode.window.showInformationMessage(`Signed in to ${endpoint}`)
        } else {
            await showAuthFailureMessage(endpoint)
        }
    }

    /** Open callback URL in browser to get token from instance. */
    public redirectToEndpointLogin(uri: string): void {
        const endpoint = formatURL(uri)
        if (!endpoint) {
            return
        }

        if (vscode.env.uiKind === vscode.UIKind.Web) {
            // VS Code Web needs a different kind of callback using asExternalUri and changes to our
            // UserSettingsCreateAccessTokenCallbackPage.tsx page in the Sourcegraph web app. So,
            // just require manual token entry for now.
            const newTokenNoCallbackUrl = new URL('/user/settings/tokens/new', endpoint)
            void vscode.env.openExternal(vscode.Uri.parse(newTokenNoCallbackUrl.href))
            void this.signinMenuForInstanceUrl(endpoint)
            return
        }

        const newTokenCallbackUrl = new URL('/user/settings/tokens/new/callback', endpoint)
        newTokenCallbackUrl.searchParams.append('requestFrom', getAuthReferralCode())
        this.authStatus.endpoint = endpoint
        void vscode.env.openExternal(vscode.Uri.parse(newTokenCallbackUrl.href))
    }

    // Refresh current endpoint history with the one from local storage
    private loadEndpointHistory(): void {
        this.endpointHistory = localStorage.getEndpointHistory() || []
    }

    // Store endpoint in local storage, token in secret storage, and update endpoint history.
    private async storeAuthInfo(
        endpoint: string | null | undefined,
        token: string | null | undefined
    ): Promise<void> {
        if (!endpoint) {
            return
        }
        await localStorage.saveEndpoint(endpoint)
        if (token) {
            await secretStorage.storeToken(endpoint, token)
        }
        this.loadEndpointHistory()
    }

    // Notifies the AuthProvider that the simplified onboarding experiment is
    // kicking off an authorization flow. That flow ends when (if) this
    // AuthProvider gets a call to tokenCallbackHandler.
    public authProviderSimplifiedWillAttemptAuth(): void {
        // FIXME: This is equivalent to what redirectToEndpointLogin does. But
        // the existing design is weak--it mixes other authStatus with this
        // endpoint and races with everything else this class does.

        // Simplified onboarding only supports dotcom.
        this.authStatus.endpoint = DOTCOM_URL.toString()
    }

    // Logs a telemetry event if the user has never authenticated to Sourcegraph.
    private handleFirstEverAuthentication(): void {
        if (localStorage.get(HAS_AUTHENTICATED_BEFORE_KEY)) {
            // User has authenticated before, noop
            return
        }
        telemetryRecorder.recordEvent('cody.auth.login', 'firstEver')
        this.setHasAuthenticatedBefore()
        void maybeStartInteractiveTutorial()
    }

    private setHasAuthenticatedBefore() {
        return localStorage.set(HAS_AUTHENTICATED_BEFORE_KEY, 'true')
    }
}
/**
 * Singleton instance of auth provider.
 */
export let authProvider: AuthProvider | null = null

export function isNetworkError(error: Error): boolean {
    const message = error.message
    return (
        message.includes('ENOTFOUND') ||
        message.includes('ECONNREFUSED') ||
        message.includes('ECONNRESET') ||
        message.includes('EHOSTUNREACH')
    )
}

export function formatURL(uri: string): string | null {
    try {
        if (!uri) {
            return null
        }

        // Check if the URI is a sourcegraph token
        if (isSourcegraphToken(uri)) {
            throw new Error('Access Token is not a valid URL')
        }

        // Check if the URI is in the correct URL format
        // Add missing https:// if needed
        if (!uri.startsWith('http')) {
            uri = `https://${uri}`
        }

        const endpointUri = new URL(uri)
        return endpointUri.href
    } catch (error) {
        console.error('Invalid URL: ', error)
        return null
    }
}

async function showAuthResultMessage(
    endpoint: string,
    authStatus: AuthStatus | undefined
): Promise<void> {
    if (authStatus?.isLoggedIn) {
        const authority = vscode.Uri.parse(endpoint).authority
        await vscode.window.showInformationMessage(`Signed in to ${authority || endpoint}`)
    } else {
        await showAuthFailureMessage(endpoint)
    }
}

async function showAuthFailureMessage(endpoint: string): Promise<void> {
    const authority = vscode.Uri.parse(endpoint).authority
    await vscode.window.showErrorMessage(
        `Authentication failed. Please ensure Cody is enabled for ${authority} and verify your email address if required.`
    )
}
