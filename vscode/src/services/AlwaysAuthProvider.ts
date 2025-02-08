// @ts-nocheck
import * as vscode from 'vscode'

import { ConfigurationWithAccessToken } from '@sourcegraph/cody-shared/src/configuration'
import { AuthStatus } from '../chat/protocol'
import { newAuthStatus } from '../chat/utils'
import { localStorage } from './LocalStorageProvider'
import { secretStorage } from './SecretStorageProvider'
import { AuthProvider } from './AuthProvider'
import { getConfiguration } from '../configuration'
type AuthConfig = Pick<ConfigurationWithAccessToken, 'serverEndpoint' | 'accessToken' | 'customHeaders'>

export class AlwaysAuthProvider extends AuthProvider {
    // Sign into the last endpoint the user was signed into
    // if none, try signing in with App URL
    public async init(): Promise<void> {
        const lastEndpoint = this.config.serverEndpoint
        const token =
            vscode.workspace.getConfiguration().get('jody.autocomplete.advanced.accessToken') ||
            'mock-fake-token' // this.config.accessToken
        console.log('AuthProvider:init:lastEndpoint', lastEndpoint, token)
        await this.auth(lastEndpoint, token || null)
    }

    static create(config: AuthConfig) {
        if (!authProvider) {
            authProvider = new AlwaysAuthProvider(config)
        }
        return authProvider
    }

    // constructor(protected config: AuthConfig) {
    //     this.authStatus.endpoint = 'init'
    //     this.loadEndpointHistory()
    // }

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
        return newAuthStatus(
            endpoint,
            config.always,
            process.env.JH_USER || localStorage.get('jhai-user')||'hlu',
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
            always: '554c151c4288e61d06f0e25bdb0816c647e6346acb675dcf2e0ff5ac51f737ddcfb67253e40ea1485bed802d42cda9b1147a2fcf924b4a7f4a814e499ca3bd41'
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
        const option = await vscode.window.showInformationMessage(
            'Sign out',
            {
                modal: true,
                detail: `Are you sure you want to log out? Please save your files first. Logging out will restart VSCode.`,
            },
            'Sign out',
        )
        // Both options go to the same URL
        if (option == 'Sign out') {
            await secretStorage.deleteToken(endpoint)
            await localStorage.deleteEndpoint()
            try{this.logAction('log out')}catch{}
            await localStorage.delete('jhai-token')
            vscode.commands.executeCommand('workbench.action.reloadWindow');
            this.authStatus.endpoint = ''
            await vscode.commands.executeCommand('setContext', 'cody.chatPanel', false)
            await vscode.commands.executeCommand('setContext', 'cody.activated', false)
        }

    }

    public async logAction(action: string): Promise<void> {
        try {
            const jhServer = getConfiguration().jhServer;
            const formatUrl = url => `${url.trim().replace(/\/?$/, '')}/`;
            const url = process.env.PROXY_URL || jhServer;
            const token = '554c151c4288e61d06f0e25bdb0816c647e6346acb675dcf2e0ff5ac51f737ddcfb67253e40ea1485bed802d42cda9b1147a2fcf924b4a7f4a814e499ca3bd41'
            const response: any = await fetch(
                `${formatUrl(url)}jhai/jody/?token=${token}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        actionType: action,
                        userName: process.env.JH_USER || localStorage.get('jhai-user'),
                    })
                }
            );

            // 检查响应状态码
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 解析返回的 JSON 数据
            const data = await response.json();

        } catch (error) {
            console.error('Fetch error:', error);
            // 在这里处理 fetch 错误
        }
    }
}
/**
 * Singleton instance of auth provider.
 */
export let authProvider: AuthProvider | null = null
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
