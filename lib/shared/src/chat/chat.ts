// @ts-nocheck
import * as vscode from 'vscode'
import type { AuthStatus } from '../auth/types'
import { ANSWER_TOKENS } from '../prompt/constants'
import type { Message } from '../sourcegraph-api'
import type { SourcegraphCompletionsClient } from '../sourcegraph-api/completions/client'
import type {
    CompletionGeneratorValue,
    CompletionParameters,
} from '../sourcegraph-api/completions/types'

type ChatParameters = Omit<CompletionParameters, 'messages'>

const DEFAULT_CHAT_COMPLETION_PARAMETERS: any = {
    model: vscode.workspace.getConfiguration().get('cody.chat.model'),
    max_tokens:
        parseInt(vscode.workspace.getConfiguration().get('cody.chat.max_tokens')) || ANSWER_TOKENS,
    temperature: parseInt(vscode.workspace.getConfiguration().get('cody.chat.temperature')),
    top_p: parseInt(vscode.workspace.getConfiguration().get('cody.chat.top_p')),
    stream: true,
}

export class ChatClient {
    constructor(
        private completions: SourcegraphCompletionsClient,
        private getAuthStatus: () => Pick<
            AuthStatus,
            'userCanUpgrade' | 'isDotCom' | 'endpoint' | 'codyApiVersion'
        >
    ) {}

    public chat(
        messages: any,
        params: Partial<ChatParameters>,
        abortSignal?: AbortSignal
    ): AsyncGenerator<CompletionGeneratorValue> {
        const authStatus = this.getAuthStatus()
        const useApiV1 = authStatus.codyApiVersion >= 1 && params.model?.includes('claude-3')
        const lastMessage = messages[messages.length - 1]
        if (lastMessage && lastMessage.speaker === 'assistant') {
            messages = messages.slice(0, -1)
        }
        messages = messages.map((ele: any, index: number) => {
            return {
                role: ele.speaker === 'human' ? 'user' : ele.speaker,
                content: ele.text,
            }
        })

        return this.completions.stream(
            {
                ...DEFAULT_CHAT_COMPLETION_PARAMETERS,
                messages,
            },
            useApiV1 ? authStatus.codyApiVersion : 0,
            abortSignal
        )
    }
}

export function sanitizeMessages(messages: Message[]): Message[] {
    let sanitizedMessages = messages

    // 1. If the last message is from an `assistant` with no or empty `text`, omit it
    let lastMessage = messages.at(-1)
    const truncateLastMessage =
        lastMessage && lastMessage.speaker === 'assistant' && !messages.at(-1)!.text
    sanitizedMessages = truncateLastMessage ? messages.slice(0, -1) : messages

    // 2. If there is any assistant message in the middle of the messages without a `text`, omit
    //    both the empty assistant message as well as the unanswered question from the `user`
    sanitizedMessages = sanitizedMessages.filter((message, index) => {
        // If the message is the last message, it is not a middle message
        if (index >= sanitizedMessages.length - 1) {
            return true
        }

        // If the next message is an assistant message with no or empty `text`, omit the current and
        // the next one
        const nextMessage = sanitizedMessages[index + 1]
        if (
            (nextMessage.speaker === 'assistant' && !nextMessage.text) ||
            (message.speaker === 'assistant' && !message.text)
        ) {
            return false
        }
        return true
    })

    // 3. Final assistant content cannot end with trailing whitespace
    lastMessage = sanitizedMessages.at(-1)
    if (lastMessage?.speaker === 'assistant' && lastMessage.text) {
        const lastMessageText = lastMessage.text.trimEnd()
        lastMessage.text = lastMessageText
    }

    return sanitizedMessages
}
