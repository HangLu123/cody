import type { Message } from '../sourcegraph-api'
export function getSimplePreamble(
    model: string | undefined,
    apiVersion: number,
    preInstruction?: string | undefined
): Message[] {
    const intro = `You are Jody, an AI coding assistant from jhinno. ${preInstruction ?? ''}`.trim()

    // API Version 1 onward support system prompts, however only enable it for
    // Claude 3 models for now
    // if (
    //     vscode.workspace.getConfiguration().get('cody.chat.model') &&
    //     vscode.workspace.getConfiguration().get('cody.chat.model').includes('qwen')
    // ) {
    //     return [
    //         {
    //             speaker: 'system',
    //             text: intro,
    //         },
    //     ]
    // }

    return [
        {
            speaker: 'human',
            text: intro,
        },
        {
            speaker: 'assistant',
            text: 'I am Jody, an AI coding assistant from jhinno.',
        },
    ]
}
