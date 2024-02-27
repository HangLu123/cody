import * as vscode from 'vscode'
import type { SourcegraphCompletionsClient } from '../sourcegraph-api/completions/client'
import type {
    CompletionGeneratorValue,
    CompletionParameters,
} from '../sourcegraph-api/completions/types'

type ChatParameters = Omit<CompletionParameters, 'messages'>

export class ChatClient {
    constructor(private completions: SourcegraphCompletionsClient) {}

    public chat(
        messages: any,
        params: Partial<ChatParameters>,
        abortSignal?: AbortSignal
    ): AsyncGenerator<CompletionGeneratorValue> {
        const DEFAULT_CHAT_COMPLETION_PARAMETERS: any = {
            "model":vscode.workspace.getConfiguration().get('cody.chat.model'),
            "max_tokens":vscode.workspace.getConfiguration().get('cody.chat.max_tokens'),
            "temperature":vscode.workspace.getConfiguration().get('cody.chat.temperature'),
            "top_p": vscode.workspace.getConfiguration().get('cody.chat.top_p'),
            "top_k": vscode.workspace.getConfiguration().get('cody.chat.top_k'),
            "stream":true
        }
        messages = messages.map((ele: any)=>{
            return{
                'role':ele.speaker=='human'?'user':(ele.speaker=="assistant"?"system":ele.speaker),
                'content':ele.text
            }
        })

        return this.completions.stream(
            {
                ...DEFAULT_CHAT_COMPLETION_PARAMETERS,
                messages
            },
            abortSignal
        )
    }
}
