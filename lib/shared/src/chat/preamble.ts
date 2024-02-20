import type { Message } from '../sourcegraph-api'

export function getSimplePreamble(preInstruction?: string | undefined): Message[] {
    return preInstruction? [
        {
            'speaker': 'human',
            'text': `${
                preInstruction ? ` ${preInstruction}` : ''
            }`,
        },
        {
            'speaker': 'assistant',
            'text': 'Ok.',
        },
    ]:[]
}
