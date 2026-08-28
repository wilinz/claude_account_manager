import type { Strings } from './zh'

/** 英文文案。类型来自 zh.ts —— 少一个键、参数对不上，都在编译期挡下。 */
export const en: Strings = {
  langName: { auto: 'Follow browser', zh: '中文', en: 'English' },

  common: {
    extName: 'Claude Account Switcher',
    cancel: 'Cancel',
    save: 'Save',
    clear: 'Clear',
    close: 'Close',
    delete: 'Delete',
    note: 'Note',
    subscription: 'Billing',
    switch: 'Switch',
    unnamed: 'Unnamed account',
    thisAccount: 'this account',
    currentAccount: 'the current account',
    loggedIn: 'signed in',
    loadFailed: 'Failed to load',
    actionFailed: 'Something went wrong',
    switchFailed: 'Switch failed',
    sessionUsable: 'Session ready',
    never: 'never used',
    justNow: 'just now',
    minutesAgo: (n: number) => `${n} min ago`,
    hoursAgo: (n: number) => `${n} hr ago`,
    daysAgo: (n: number) => (n === 1 ? '1 day ago' : `${n} days ago`),
  },

  popup: {
    strategy: {
      merge: 'Merge (keep the newer session)',
      overwrite: 'Overwrite matching accounts',
      replace: 'Replace all local accounts',
    },
    parts: {
      cookies: { title: 'Session cookies', desc: 'The credential itself — enough to sign straight in' },
      billing: { title: 'Billing', desc: 'Monthly renewal date and store' },
      settings: { title: 'Extension settings', desc: 'Auto-capture, logout interception, and the rest' },
    },
    sheet: {
      aria: 'Choose what to include',
      exportTitle: (what: string) => `Export ${what}`,
      importTitle: 'Import backup',
      exportSub: 'Choose what goes into the file',
      importSub: (file: string) => `What to restore from ${file}`,
      exportedAt: (when: string) => ` · exported ${when}`,
      missing: 'not in this file',
      strategyLabel: 'Accounts that already exist',
      replaceConfirm: '"Replace all local accounts" wipes your existing records. Continue?',
      atLeastOne: 'Pick at least one',
      doExport: 'Export',
      doImport: 'Import',
    },
    billing: {
      anchor: 'Renewal day',
      platform: 'Store',
      note: 'Copy the next renewal date exactly as the store shows it. Each store computes it in its own time zone, so deriving it from the purchase time is off by a day.',
      cleared: 'Billing info cleared',
      saved: 'Billing info saved',
    },
    stale: {
      text: 'The background is still running old code — saving and exporting may fail silently.',
      reload: 'Reload extension',
    },
    header: {
      openSite: 'Open claude.ai in a new tab',
      loading: 'Loading…',
      current: (who: string) => `Current: ${who}`,
      notLoggedIn: 'Not signed in to claude.ai',
      autoSaved: (rel: string) => `Session saved automatically · ${rel}`,
      notSavedYet: 'This session has not been saved yet; it will be shortly',
      autoOffWithSnapshot: (rel: string) => `Auto-capture is off · snapshot from ${rel}`,
      autoOffNoSnapshot: 'Auto-capture is off · this session has no snapshot',
    },
    actions: {
      add: '＋ Add account',
      saveSession: 'Save current session',
      logout: 'Log out of this account',
    },
    transfer: {
      section: 'Import & export',
      exportAll: 'Export all',
      importBackup: 'Import backup',
      encrypt: 'Encrypt export',
      encryptOff: 'Encryption off',
      passwordPlaceholder: 'Set a password',
      warnPlain:
        'An unencrypted export contains plaintext session cookies — they are login credentials. Do not share or upload it.',
      warnEncrypted:
        'Exports are encrypted with AES-GCM-256 (key derived via PBKDF2-SHA256). A lost password cannot be recovered.',
      settings: 'Settings',
      usage: 'Usage overview',
      all: 'all',
      selected: 'selected',
    },
    list: {
      selectedOf: (n: number, total: number) => `${n} of ${total} selected`,
      count: (n: number) => (n === 1 ? '1 account' : `${n} accounts`),
      exportSelected: 'Export selected',
      deleteSelected: 'Delete selected',
      empty:
        'No accounts recorded yet. Sign in to claude.ai once and hit "Save current session" above, or expand "Import & export" to restore a backup.',
      selectAria: (who: string) => `Select ${who}`,
      inUse: 'In use',
      usable: (rel: string) => `Session ready · ${rel}`,
      emailOnly: 'Email only',
      switchTitle: 'Switch using the saved session',
      switchTitleEmail: 'No usable session — the login page will be prefilled with this email',
      billingTitle: 'Next renewal date and store',
    },
    msg: {
      saved: (who: string) => `Saved ${who}`,
      saveFailed: 'Save failed',
      switched: (who: string) => `Switched to ${who}`,
      deleted: 'Deleted',
      deletedN: (n: number) => (n === 1 ? 'Deleted 1 account' : `Deleted ${n} accounts`),
      deleteConfirm: (n: number, names: string) =>
        `Delete the records for ${n === 1 ? 'this account' : `these ${n} accounts`}?\n${names}`,
      notePrompt: 'Give this account a note',
      loggedOut: 'Logged out of this session (the snapshot is kept)',
      addConfirm:
        'This saves the current session, then logs out locally and opens the login page so you can add another account.\n' +
        'The current session stays in the list and you can switch back any time. Continue?',
      addSaved: 'Current session saved — go ahead and sign in',
      addOpened: 'Login page opened',
      needPassword: 'Enter a password, or uncheck "Encrypt export"',
      plainConfirm:
        'An unencrypted backup contains session credentials that log straight in. Export without encryption?',
      exported: (what: string, n: number, withSession: number, encrypted: boolean) =>
        `Exported ${what} — ${n} account${n === 1 ? '' : 's'} (${withSession} with a session), ${
          encrypted ? 'encrypted with your password' : 'unencrypted'
        }`,
      badJson: 'That file is not valid JSON',
      passwordPrompt: 'This backup is encrypted. Enter the password you set when exporting',
      needSecret: 'This backup is encrypted — a password is required to import it',
      readFailed: 'Could not read the file',
      imported: (added: number, updated: number, skipped: number, invalid: number, settings: boolean) => {
        const done = [`${added} added`, `${updated} updated`]
        if (skipped) done.push(`${skipped} skipped`)
        if (invalid) done.push(`${invalid} invalid ignored`)
        if (settings) done.push('settings restored')
        return `Import complete: ${done.join(' · ')}`
      },
    },
  },

  settings: {
    title: 'Settings',
    sub: 'Changes take effect immediately — nothing to save.',
    saved: 'Saved',
    usage: 'Usage overview',
    loading: 'Loading settings…',
    language: {
      group: 'Language',
      title: 'Interface language',
      desc: '"Follow browser" picks by your browser\'s display language: Chinese for Chinese locales, English otherwise.',
    },
    groups: {
      capture: 'Session capture',
      loginPage: 'Login page',
      switching: 'Switching accounts',
      logout: 'Logging out',
      backup: 'Backups',
    },
    items: {
      autoCapture: {
        title: 'Save the current session automatically',
        desc: 'Snapshots cookies into the matching account on login, switch, and session renewal. With this off you can only save manually from the popup, which makes sessions easy to lose.',
      },
      autoPrompt: {
        title: 'Offer accounts when not signed in',
        desc: 'When you open claude.ai signed out, your saved accounts are listed right away. With this off you can still summon the dropdown by clicking the email field.',
      },
      autoFillEmail: {
        title: 'Prefill the email address',
        desc: 'When exactly one account matches and it has no usable session, its email is typed into the login field.',
      },
      clearSiteDataOnSwitch: {
        title: 'Clear the previous account’s page cache on switch',
        desc: 'Without this the page calls the API carrying the previous identity, gets a 403, and redirects to the login page. Device binding is preserved, so you are not asked to verify again.',
      },
      reloadTabsAfterSwitch: {
        title: 'Reload claude.ai tabs after switching',
        desc: 'Without this the page keeps showing the previous account until you reload it yourself.',
      },
      interceptLogout: {
        title: 'Intercept the site’s "Log out" and ask',
        desc: 'When you click claude.ai’s own log out, ask first whether you mean to sign out or just drop the local session. Signing out revokes the session server-side, which voids the saved snapshot and you cannot switch back.',
        warnWhenOff:
          'With this off, clicking log out on claude.ai signs you out for real and that account’s saved session dies immediately.',
      },
      encryptExport: {
        title: 'Encrypt exports',
        desc: 'AES-GCM-256, key derived via PBKDF2-SHA256. A lost password cannot be recovered.',
        warnWhenOff:
          'An unencrypted export contains plaintext session cookies — they are login credentials. Never share or upload one.',
      },
    },
  },

  usage: {
    title: 'Usage across accounts',
    sub: 'Each account is queried with its own session; the account you are signed in as never changes.',
    fetchedAt: (rel: string) => `Data from ${rel}`,
    refreshing: 'Refreshing…',
    refresh: 'Refresh',
    querying: 'Querying…',
    loadingAll: 'Querying each account…',
    empty: 'No accounts saved yet.',
    raw: 'Raw data',
    rawCollapse: 'Hide raw data',
    queryFailed: 'Query failed',
    allFailed:
      'Not a single account returned usage. The reason on each card is usually the answer; if they are all network errors, take a look at ',
    allFailedTail: ' for errors from the background.',
    today: (time: string) => `today ${time}`,
    tomorrow: (time: string) => `tomorrow ${time}`,
    lessThanMinute: 'under a minute',
    minutes: (n: number) => `${n} min`,
    hours: (h: number, m: number) => (m ? `${h} hr ${m} min` : `${h} hr`),
    days: (d: number, h: number) => (h ? `${d}d ${h}h` : `${d}d`),
    resettingSoon: 'resetting now',
    resetIn: (countdown: string, clock: string) => `resets in ${countdown} · ${clock}`,
    windows: {
      five_hour: '5-hour session',
      seven_day: '7 days',
      seven_day_opus: '7 days Opus',
      seven_day_sonnet: '7 days Sonnet',
      seven_day_cowork: '7 days Cowork',
      extra: 'Extra usage',
    } as Record<string, string>,
  },

  picker: {
    aria: 'Choose a Claude account',
    title: 'Choose an account to use',
    desc: 'Accounts marked "Session ready" sign you straight in. The rest fill the login field with their email so you can go through the code flow.',
    lastUsed: (rel: string) => `last used ${rel}`,
    needLogin: 'Needs signing in again',
    switching: 'Switching…',
    emailOnly: 'Email only',
    dontPrompt: 'Stop showing this',
    noEmail: 'No email recorded for this account — sign in manually',
    noEmailField: 'No email field on this page',
    filled: (email: string) => `Filled in ${email} — finish the verification`,
    promptDisabled: 'Auto-prompt turned off; you can re-enable it in the extension popup',
  },

  autofill: {
    headerSaved: 'Saved Claude accounts',
    headerNone: 'No matching accounts',
    clickToLogin: 'Click to sign in',
    ssoRelogin: (sso: string) => `Sign in again with ${sso}`,
    fillEmail: 'Fill in email',
    fillOnly: 'Email only',
    fillOnlyTitle: 'Just fill the field, do not switch accounts (Shift+Enter)',
    addOther: 'Add another account',
    addOtherHint: 'Saves the current session first, then opens the login page',
    ssoClicked: (prefix: string, sso: string) =>
      `${prefix}this account signs in with ${sso} — the button has been clicked for you`,
    ssoManual: (prefix: string, sso: string) =>
      `${prefix}this account signs in with ${sso} — click the ${sso} button on the page`,
    noEmailRecorded: (prefix: string) => `${prefix}no email recorded for this account, sign in manually once`,
    noEmailField: (prefix: string) => `${prefix}no email field found on the page`,
    filled: (prefix: string, email: string) => `${prefix}filled in ${email}`,
    addFailed: 'Could not add an account',
    noEmail: 'No email recorded for this account',
    noField: 'No email field found on the page',
    filledPlain: (email: string) => `Filled in ${email}`,
  },

  logout: {
    aria: 'How to log out',
    title: (who: string) => `How do you want to log out of ${who}?`,
    desc: 'claude.ai’s "Log out" revokes this session server-side, which also voids the snapshot saved in the extension — you will not be able to switch back with one click.',
    localTitle: 'Log out locally only',
    recommended: 'recommended',
    localBusy: 'Saving the session…',
    localDesc: 'Saves the current session, then clears local cookies only. Switch back any time.',
    revokeTitle: 'Sign out for real',
    revokeBusy: 'Marking the account…',
    revokeDesc: 'Actually signs out of claude.ai. This session dies immediately and you will have to sign in again.',
    dontIntercept: 'Stop intercepting',
    doneLocal: 'Session saved and logged out locally — switch back any time from the extension',
  },

  bg: {
    switching: 'An account switch is in progress',
    notLoggedIn: 'Not signed in to claude.ai',
    identityFailed: 'The session has expired, or the account details could not be read',
    noSessionCookie: (name: string) => `${name} not found`,
    accountMissing: 'No such account',
    noSavedSession: 'This account has no saved session — sign in again with its email',
    writeFailed: (names: string) =>
      `Could not write the session cookies (${names}); the previous session has been restored`,
    invalidSession: (count: number, savedAt: string, restored: boolean) =>
      `All ${count} cookies were restored, but the server considers this session invalid.\n` +
      `Snapshot taken: ${savedAt}\n` +
      `The usual cause is clicking "Log out" on claude.ai — that revokes the session server-side and the saved cookies become void. ` +
      `Switch accounts from this extension instead, or use "Log out of this account" in the popup (which only clears local cookies).\n` +
      (restored
        ? 'The pre-switch state has been restored; this account needs signing in again.'
        : 'Heads up: the pre-switch session could not be restored either, so you are signed out and will need to sign in again.'),
    unverified: (who: string, detail: string) =>
      `The session for ${who} was written, but claude.ai could not be reached to confirm it (${detail}).\n` +
      `Nothing was rolled back. Reload the page to check; if it still shows the old account, just try again.`,
    noSession: 'No saved session',
    sessionExpired: 'The session has expired — sign in again',
    noQuota: 'No quota data (free account)',
    usageFailed: (detail: string) => `Could not read usage (${detail})`,
    noneSelected: 'No accounts selected',
    badgeTitle: (label: string | undefined) =>
      label ? `Claude Account Switcher — ${label}` : 'Claude Account Switcher — signed out',
    unknownMessage: (type: string) =>
      `The background does not recognize this message type: ${type}. Most likely the extension code was updated without being reloaded — reload it on chrome://extensions.`,
  },

  messaging: {
    noResponse: 'The background did not respond — reload the extension',
  },

  transfer: {
    fileWarning:
      'This file contains plaintext claude.ai session cookies, which are login credentials. Do not share, upload, or commit it to a repository.',
    notObject: 'The file is not a valid JSON object',
    noAccountsArray: 'The file has no accounts array — it may not be an export from this extension',
    unknownFormat: (format: string) => `Unrecognized file format: ${format}`,
    noValidAccounts: 'The file contains no usable account records',
  },

  billing: {
    platforms: { web: 'Web', ios: 'App Store', android: 'Google Play' },
    rules: {
      web: 'Short months fall to the last day, then return to the original day (Stripe docs)',
      ios: 'Short months fall to the last day, then return to the original day (App Store Connect Help)',
      android: 'Short months move the anchor down for good — it stays on the new day (Google Play docs)',
    },
    renewal: (where: string, month: number, day: number, days: number) => {
      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
      return `${where}renews ${MONTHS[month - 1]} ${day} · ${when}`
    },
  },

  crypto: {
    warning:
      'This file is password-encrypted (PBKDF2-SHA256 + AES-GCM-256). A lost password cannot be recovered.',
    unsupported: 'Unsupported cipher — the file may come from a newer version of the extension',
    wrongPassword: 'Wrong password, or the file is corrupted',
    notJson: 'Decryption succeeded but the contents are not valid JSON',
  },

  net: {
    notJson: 'the response was not JSON',
    timeout: 'timed out',
    timeoutMs: (ms: number) => `timed out after ${ms}ms`,
    networkError: 'network error',
  },
}
