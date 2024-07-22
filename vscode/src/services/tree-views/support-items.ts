import type { CodySidebarTreeItem } from './treeViewItems'

export const SupportSidebarItems: CodySidebarTreeItem[] = [
    {
        title: 'Sign Out',
        icon: 'account',
        command: { command: 'cody.sidebar.account' },
        requirePaid: false,
    },
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
