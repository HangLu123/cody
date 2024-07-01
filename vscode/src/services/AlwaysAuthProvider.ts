// @ts-nocheck
import * as vscode from 'vscode'

import { ConfigurationWithAccessToken } from '@sourcegraph/cody-shared/src/configuration'
import { AuthStatus } from '../chat/protocol'
import { newAuthStatus } from '../chat/utils'
import { localStorage } from './LocalStorageProvider'
import { AuthProvider } from './AuthProvider'

export class AlwaysAuthProvider extends AuthProvider {
    // Sign into the last endpoint the user was signed into
    // if none, try signing in with App URL
    public async init(): Promise<void> {
        const lastEndpoint = this.config.serverEndpoint
        const token =
            vscode.workspace.getConfiguration().get('cody.autocomplete.advanced.accessToken') ||
            'mock-fake-token' // this.config.accessToken
        console.log('AuthProvider:init:lastEndpoint', lastEndpoint, token)
        await this.auth(lastEndpoint, token || null)
    }

    // Display quickpick to select endpoint to sign in to
    public async signinMenu(
        type?: 'enterprise' | 'dotcom' | 'token' | 'app',
        uri?: string
    ): Promise<void> {
        // await this.appAuth(uri)
    }

    private fetchSourcegraphAPI<T>(
        url: string,
        variables: Record<string, any> = {}
    ): Promise<T | Error> {
        return fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        })
            .then(response => {
                return true
            })
            .catch(error => {
                return false
            })
    }

    // Create Auth Status
    protected async _makeAuthStatus(
        config: Pick<ConfigurationWithAccessToken, 'serverEndpoint' | 'accessToken' | 'customHeaders'>
    ): Promise<AuthStatus> {
        const endpoint = config.serverEndpoint
        process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
        const serverEndpoint =
            vscode.workspace.getConfiguration().get('cody.autocomplete.advanced.serverEndpoint') ||
            vscode.workspace.getConfiguration().get('cody.chat.advanced.serverEndpoint')
        const jhServer = vscode.workspace.getConfiguration().get('cody.jhServer')
        return newAuthStatus(
            endpoint,
            config.always,
            config.always,
            config.always,
            config.always,
            /* userCanUpgrade: */ config.always,
            '1.0',
            undefined,
            '',
            '',
            '',
            {
                chatModel: 'anthropic/claude-2.0',
                chatModelMaxTokens: 12000,
                fastChatModel: 'anthropic/claude-instant-1.2',
                fastChatModelMaxTokens: 9000,
                completionModel: 'anthropic/claude-instant-1.2',
                provider: 'sourcegraph',
            })  
        
        void vscode.window.showErrorMessage(
            '无法连接到景行AI平台，插件暂不可用，请先到景行AI平台部署服务'
        )
        return
    }

    // It processes the authentication steps and stores the login info before sharing the auth status with chatview
    public async auth(
        uri: string,
        token: string | null,
        customHeaders?: {} | null,
        always?: boolean
    ): Promise<{ authStatus: AuthStatus; isLoggedIn: boolean } | null> {
        const endpoint = formatURL(uri) || ''
        const config = {
            serverEndpoint: endpoint,
            accessToken: token,
            customHeaders: customHeaders || this.config.customHeaders,
            always: localStorage.get('always')||always
        }
        const authStatus = await this._makeAuthStatus(config)
        const isLoggedIn = authStatus.requiresVerifiedEmail
        authStatus.isLoggedIn = isLoggedIn
        await this.storeAuthInfo(endpoint, token)
        await this.syncAuthStatus(authStatus)
        await vscode.commands.executeCommand('setContext', 'cody.activated', isLoggedIn)
        return { authStatus, isLoggedIn }
    }

        // Log user out of the selected endpoint (remove token from secret)
    public async signout(endpoint: string): Promise<void> {
        await localStorage.delete('always')
        await this.auth(endpoint, null, '', false)
        this.authStatus.endpoint = ''
        await vscode.commands.executeCommand('setContext', CodyChatPanelViewType, false)
        await vscode.commands.executeCommand('setContext', 'cody.activated', false)
    }
}

function formatURL(uri: string): string | null {
    if (!uri) {
        return null
    }
    // Check if the URI is in the correct URL format
    // Add missing https:// if needed
    if (!uri.startsWith('http')) {
        uri = `https://${uri}`
    }
    try {
        const endpointUri = new URL(uri)
        return endpointUri.href
    } catch {
        console.error('Invalid URL')
    }
    return null
}
