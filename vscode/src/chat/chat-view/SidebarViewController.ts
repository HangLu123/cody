
import * as vscode from 'vscode'

import { type Configuration, DOTCOM_URL } from '@sourcegraph/cody-shared'

import type { View } from '../../../webviews/NavBar'
import type { startTokenReceiver } from '../../auth/token-receiver'
import { logDebug } from '../../log'
import type { AuthProvider } from '../../services/AuthProvider'
import type { AlwaysAuthProvider } from '../../services/AlwaysAuthProvider'
import { AuthProviderSimplified } from '../../services/AuthProviderSimplified'
import { localStorage } from '../../services/LocalStorageProvider'
import { telemetryService } from '../../services/telemetry'
import { telemetryRecorder } from '../../services/telemetry-v2'
import { openExternalLinks } from '../../services/utils/workspace-action'
import type { ContextProvider } from '../ContextProvider'
import type { MessageErrorType, MessageProviderOptions } from '../MessageProvider'
import type { ExtensionMessage, WebviewMessage } from '../protocol'

import {
    closeAuthProgressIndicator,
    startAuthProgressIndicator,
} from '../../auth/auth-progress-indicator'
import { addWebviewViewHTML } from './ChatManager'

export interface SidebarChatWebview extends Omit<vscode.Webview, 'postMessage'> {
    postMessage(message: ExtensionMessage): Thenable<boolean>
}

export interface SidebarViewOptions extends MessageProviderOptions {
    extensionUri: vscode.Uri
    startTokenReceiver?: typeof startTokenReceiver
    config: Pick<Configuration, 'isRunningInsideAgent'>
}

export class SidebarViewController implements vscode.WebviewViewProvider {
    private extensionUri: vscode.Uri
    public webview?: SidebarChatWebview

    private disposables: vscode.Disposable[] = []

    private authProvider: AuthProvider
    private AlwaysAuthProvider: AlwaysAuthProvider
    private readonly contextProvider: ContextProvider
    private startTokenReceiver?: typeof startTokenReceiver
    private config: Pick<Configuration, 'isRunningInsideAgent'>

    constructor({ extensionUri, ...options }: SidebarViewOptions) {
        this.authProvider = options.authProvider
        this.AlwaysAuthProvider = options.AlwaysAuthProvider
        this.contextProvider = options.contextProvider
        this.extensionUri = extensionUri
        this.startTokenReceiver = options.startTokenReceiver
        this.config = options.config
    }

    private async onDidReceiveMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'login':
                process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
                try {
                    const serverEndpoint:any =
                        vscode.workspace.getConfiguration().get('cody.autocomplete.advanced.serverEndpoint') ||
                        this.config.chatServerEndpoint
                    const jhServer = vscode.workspace.getConfiguration().get('cody.jhServer')
                    if (serverEndpoint?.includes('dockerService') || jhServer) {
                        const baseUrl = serverEndpoint?.includes('dockerService')
                                ? `${serverEndpoint.split(':')[0]}:${serverEndpoint.split(':')[1].split(':')[0]}`
                                : jhServer
                        const response: any = await fetch(
                            `${baseUrl}/appform/ajaxlogin?username=${message.userName}&password=${message.password}&desktop=0&from=jhai&local=0&locale=zh_CN`,
                            {
                                method: 'GET',
                                headers: { 'Content-Type': 'application/json' },
                            }
                        );

                        // 检查响应状态码
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }

                        // 解析返回的 JSON 数据
                        const data = await response.json();

                        if (data.result === 'failed') {
                            void vscode.window.showErrorMessage(
                                data.message
                            )
                            // 在这里处理登录失败的逻辑
                        } else {
                            localStorage.set('always', 'always')
                            const authStatus = await this.authProvider.auth('', '', {} ,true)
                            void vscode.window.showInformationMessage('登录成功')
                        }
                    }else{
                        void vscode.window.showErrorMessage(
                            '请先按照文档完成插件配置'
                        )
                        vscode.commands.executeCommand('cody.settings.extension')
                    }
                } catch (error) {
                    console.error('Fetch error:', error);
                    // 在这里处理 fetch 错误
                }
                break
            case 'apply':
                const serverEndpoint:any =
                    vscode.workspace.getConfiguration().get('cody.autocomplete.advanced.serverEndpoint') ||
                    vscode.workspace.getConfiguration().get('cody.chat.advanced.serverEndpoint')
                const jhServer = vscode.workspace.getConfiguration().get('cody.jhServer')
                if (serverEndpoint?.includes('dockerService') || jhServer) {
                    const baseUrl = serverEndpoint?.includes('dockerService')
                            ? `${serverEndpoint.split(':')[0]}:${serverEndpoint.split(':')[1].split(':')[0]}`
                            : jhServer
                    vscode.env.openExternal(vscode.Uri.parse(baseUrl));
                }else{
                    void vscode.window.showErrorMessage(
                        '请先配置服务地址'
                    )
                }

                break
            case 'setting':
                vscode.commands.executeCommand('cody.settings.extension')
                break
            case 'ready':
                await this.contextProvider.syncAuthStatus()
                break
            case 'initialized':
                logDebug('SidebarViewController:onDidReceiveMessage', 'initialized')
                await this.setWebviewView('chat')
                await this.contextProvider.init()
                break
            case 'auth': {
                if (message.authKind === 'callback' && message.endpoint) {
                    this.authProvider.redirectToEndpointLogin(message.endpoint)
                    break
                }
                if (message.authKind === 'simplified-onboarding') {
                    const endpoint = DOTCOM_URL.href

                    let tokenReceiverUrl: string | undefined = undefined
                    closeAuthProgressIndicator()
                    startAuthProgressIndicator()
                    tokenReceiverUrl = await this.startTokenReceiver?.(
                        endpoint,
                        async (token, endpoint) => {
                            closeAuthProgressIndicator()
                            const authStatus = await this.authProvider.auth(endpoint, token)
                            telemetryService.log(
                                'CodyVSCodeExtension:auth:fromTokenReceiver',
                                {
                                    type: 'callback',
                                    from: 'web',
                                    success: Boolean(authStatus?.isLoggedIn),
                                },
                                {
                                    hasV2Event: true,
                                }
                            )
                            telemetryRecorder.recordEvent(
                                'cody.auth.fromTokenReceiver.web',
                                'succeeded',
                                {
                                    metadata: {
                                        success: authStatus?.isLoggedIn ? 1 : 0,
                                    },
                                }
                            )
                            if (!authStatus?.isLoggedIn) {
                                void vscode.window.showErrorMessage(
                                    'Authentication failed. Please check your token and try again.'
                                )
                            }
                        }
                    )

                    const authProviderSimplified = new AuthProviderSimplified()
                    const authMethod = message.authMethod || 'dotcom'
                    const successfullyOpenedUrl = await authProviderSimplified.openExternalAuthUrl(
                        this.authProvider,
                        authMethod,
                        tokenReceiverUrl
                    )
                    if (!successfullyOpenedUrl) {
                        closeAuthProgressIndicator()
                    }
                    break
                }
                // cody.auth.signin or cody.auth.signout
                await vscode.commands.executeCommand(`cody.auth.${message.authKind}`)
                break
            }
            case 'reload':
                await this.authProvider.reloadAuthStatus()
                telemetryService.log('CodyVSCodeExtension:authReloadButton:clicked', undefined, {
                    hasV2Event: true,
                })
                telemetryRecorder.recordEvent('cody.authReloadButton', 'clicked')
                break
            case 'event':
                telemetryService.log(message.eventName, message.properties)
                break
            case 'links':
                void openExternalLinks(message.value)
                break
            case 'simplified-onboarding':
                if (message.onboardingKind === 'web-sign-in-token') {
                    void vscode.window
                        .showInputBox({ prompt: 'Enter web sign-in token' })
                        .then(async token => {
                            if (!token) {
                                return
                            }
                            const authStatus = await this.authProvider.auth(DOTCOM_URL.href, token)
                            if (!authStatus?.isLoggedIn) {
                                void vscode.window.showErrorMessage(
                                    'Authentication failed. Please check your token and try again.'
                                )
                            }
                        })
                    break
                }
                break
            case 'show-page':
                await vscode.commands.executeCommand('show-page', message.page)
                break
            default:
                this.handleError(new Error('Invalid request type from Webview'), 'system')
        }
    }

    /**
     * Display error message in webview as a banner alongside the chat.
     */
    private handleError(error: Error, type: MessageErrorType): void {
        if (type === 'transcript') {
            // not required for non-chat view
            return
        }
        void this.webview?.postMessage({
            type: 'errors',
            errors: error.toString(),
        })
    }

    /**
     * Set webview view
     */
    private async setWebviewView(view: View): Promise<void> {
        await vscode.commands.executeCommand('cody.chat.focus')
        await this.webview?.postMessage({
            type: 'view',
            view: view,
        })
    }

    /**
     * create webview resources for Auth page
     */
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,

        _context: vscode.WebviewViewResolveContext<unknown>,

        _token: vscode.CancellationToken
    ): Promise<void> {
        this.webview = webviewView.webview
        this.contextProvider.webview = webviewView.webview

        const webviewPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews')
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [webviewPath],
            enableCommandUris: true,
        }

        await addWebviewViewHTML(this.extensionUri, webviewView)

        // Register to receive messages from webview
        this.disposables.push(
            webviewView.webview.onDidReceiveMessage(message => this.onDidReceiveMessage(message))
        )
    }
}
