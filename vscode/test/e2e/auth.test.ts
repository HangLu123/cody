import { expect } from '@playwright/test'
import { SERVER_URL, VALID_TOKEN } from '../fixtures/mock-server'

import { focusSidebar } from './common'
import { type ExpectedV2Events, signOut, test } from './helpers'

test.extend<ExpectedV2Events>({
    // list of V2 telemetry events we expect this test to log, add to this list as needed
    expectedV2Events: [
        'cody.extension:installed',
        'cody.codyIgnore:hasFile',
        'cody.auth:failed',
        'cody.auth.login:clicked',
        'cody.auth.signin.menu:clicked',
        'cody.auth.login:firstEver',
        'cody.auth.signin.token:clicked',
        'cody.auth:connected',
        'cody.auth.logout:clicked',
        'cody.auth:disconnected',
        'cody.statusbarIcon:clicked',
    ],
})('requires a valid auth token and allows logouts', async ({ page, sidebar }) => {
    await expect(page.getByText('Authentication failed.')).not.toBeVisible()
    await sidebar?.getByRole('button', { name: 'Sign In to Your Enterprise Instance' }).click()
    await page.getByRole('option', { name: 'Sign In with URL and Access Token' }).click()
    await page.getByRole('combobox', { name: 'input' }).fill(SERVER_URL)
    await page.getByRole('combobox', { name: 'input' }).press('Enter')
    await page.getByRole('combobox', { name: 'input' }).fill('abcdefghijklmnopqrstuvwxyz')
    await page.getByRole('combobox', { name: 'input' }).press('Enter')

    await expect(page.getByRole('alert').getByText('Authentication failed.')).toBeVisible()

    await sidebar?.getByRole('button', { name: 'Sign In to Your Enterprise Instance' }).click()
    await page.getByRole('option', { name: 'Sign In with URL and Access Token' }).click()
    await page.getByRole('combobox', { name: 'input' }).fill(SERVER_URL)
    await page.getByRole('combobox', { name: 'input' }).press('Enter')
    await page.getByRole('combobox', { name: 'input' }).fill(VALID_TOKEN)
    await page.getByRole('combobox', { name: 'input' }).press('Enter')

    // Sign out.
    await signOut(page)
    await focusSidebar(page)

    const sidebarFrame = page.frameLocator('iframe.webview').frameLocator('iframe').first()
    await expect(
        sidebarFrame.getByRole('button', { name: 'Sign In to Your Enterprise Instance' })
    ).toBeVisible()

    // Click on Cody at the bottom menu to open sign in
    await page.getByRole('button', { name: 'Sign In, Sign in to get started with Cody' }).click()

    // Makes sure the sign in page is loaded in the sidebar view with Cody: Chat as the heading
    // instead of the chat panel.
    await expect(page.getByRole('heading', { name: 'Cody: Chat' })).toBeVisible()
    await page.getByRole('heading', { name: 'Cody: Chat' }).click()
})
