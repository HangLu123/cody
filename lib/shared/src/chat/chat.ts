import * as vscode from 'vscode'
import { ANSWER_TOKENS } from '../prompt/constants'
import type { Message } from '../sourcegraph-api'
import type { SourcegraphCompletionsClient } from '../sourcegraph-api/completions/client'
import type {
    CompletionGeneratorValue,
    CompletionParameters,
} from '../sourcegraph-api/completions/types'

type ChatParameters = Omit<CompletionParameters, 'messages'>

export class ChatClient {
    constructor(private completions: SourcegraphCompletionsClient) {}

    public chat(
        messages: Message[],
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
        messages = messages.map(ele=>{
            return{
                'role':ele.speaker=='human'?'user':(ele.speaker=="assistant"?"system":ele.speaker),
                'content':ele.text
            }
        })
        const isLastMessageFromHuman = messages.length > 0 && messages.at(-1)!.role === 'user'
        const augmentedMessages =
            // HACK: The fireworks chat inference endpoints requires the last message to be from a
            // human. This will be the case in most of the prompts but if for some reason we have an
            // assistant at the end, we slice the last message for now.
            params?.model?.startsWith('fireworks/')
                ? isLastMessageFromHuman
                    ? messages
                    : messages.slice(0, -1)
                : isLastMessageFromHuman
                  ? messages.concat([{ speaker: 'assistant' }])
                  : messages

        return this.completions.stream(
            {
                ...DEFAULT_CHAT_COMPLETION_PARAMETERS,
                messages
            },
            abortSignal
        )
    }
}
