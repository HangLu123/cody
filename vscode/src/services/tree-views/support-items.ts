import type { CodySidebarTreeItem } from './treeViewItems'

export const SupportSidebarItems: CodySidebarTreeItem[] = [
    {
        title: 'Settings',
        icon: 'settings-gear',
        command: { command: 'cody.sidebar.settings' },
    },
    {
        title: 'Keyboard Shortcuts',
        icon: 'keyboard',
        command: { command: 'cody.sidebar.keyboardShortcuts' },
    },
]
