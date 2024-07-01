// @ts-nocheck
import { VSCodeButton, VSCodeTextField, VSCodeLink } from '@vscode/webview-ui-toolkit/react'

import type { TelemetryService } from '@sourcegraph/cody-shared'

import type { AuthMethod } from '../src/chat/protocol'

import type { VSCodeWrapper } from './utils/VSCodeApi'

import styles from './OnboardingExperiment.module.css'
import logo from './logo-small.png'
import { useState } from 'react'

interface LoginProps {
    simplifiedLoginRedirect: (method: AuthMethod) => void
    telemetryService: TelemetryService
    uiKindIsWeb: boolean
    vscodeAPI: VSCodeWrapper
}

// A login component which is simplified by not having an app setup flow.
export const LoginSimplified: React.FunctionComponent<React.PropsWithoutRef<LoginProps>> = ({
    simplifiedLoginRedirect,
    vscodeAPI,
}) => {
    const [userName, setUserName] = useState('')
    const [password, setPassword] = useState('')
    const signInClick = (e:any) => {
        e.preventDefault();
        vscodeAPI.postMessage({ command: 'login', userName, password })
    }
    const applyAcount = (e:any) => {
        e.preventDefault();
        vscodeAPI.postMessage({ command: 'apply' })
    }
    const configExt = (e:any) => {
        e.preventDefault();
        vscodeAPI.postMessage({ command: 'setting' })
    }
    return (
        <div className={styles.container}>
            <div className={styles.sectionsContainer}>
                <form onSubmit={signInClick} className={styles.section}>
                    <p className={styles.desc}>
                        登陆前请先完成
                        <VSCodeLink className={styles.link} onClick={configExt}>
                            插件配置
                        </VSCodeLink>
                    </p>
                    <p  className={styles.desc}>
                        无账户？请先
                        <VSCodeLink className={styles.link} onClick={applyAcount}>
                            申请账户
                        </VSCodeLink>
                    </p>
                    <p  className={styles.logoContainer}>
                        <img src={logo} alt="Hi, I'm Jody" className={styles.logo} />
                        <h1>Jody</h1>
                        <h1>请使用景行门户账号登录</h1>
                    </p>

                    <div className={styles.buttonWidthSizer}>
                        <div className={styles.buttonStack}>
                            <VSCodeTextField
                                placeholder="登录账号"
                                value={userName}
                                onInput={(e: any) => setUserName(e.target.value)}
                                className={styles.button}
                            />
                            <VSCodeTextField
                                placeholder="密码"
                                type="password"
                                value={password}
                                onInput={(e: any) => setPassword(e.target.value)}
                                className={styles.button}
                            />
                        </div>
                    </div>
                    <div className={styles.buttonWidthSizer}>
                        <div className={styles.buttonStack}>
                            <VSCodeButton className={styles.button} type="submit">
                                登录
                            </VSCodeButton>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    )
}
