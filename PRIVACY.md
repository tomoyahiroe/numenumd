# numenumd privacy policy

English | [日本語](PRIVACY.ja.md)

Last updated: 2026-09-27

## Information we collect

**numenumd does not collect or send any information.** No data leaves your
computer. The only thing it stores on your computer is a record of _which file
was saved where_, so that you don't have to pick the save location again every
time (see "Where data is stored" below). **It never stores the text you are
editing.**

Specifically, numenumd does none of the following:

- Collect personally identifiable information (name, email address, postal
  address, age, etc.)
- Collect health, financial, authentication or location information
- Collect browsing history or activity logs such as clicks and scrolling
- Send or upload the contents of the Markdown file you are editing
- Use analytics, crash reporting or advertising identifiers
- Create cookies or server-side accounts

## What the extension does

numenumd only runs on pages opened with `file://` whose file name ends in `.md`.

1. It reads the text Chrome displays for that file, inside the browser tab.
2. It parses the Markdown and shows it as an editor, entirely inside the tab (on
   your computer).
3. When you save, it writes **directly back to the local file you chose**
   through the File System Access API.

Images referenced in the file with a local path are displayed by the browser
directly from your disk; remote images are never loaded.

All of this happens inside the browser tab. numenumd makes no network requests
at all. There is no numenumd server, so there is nowhere to send data to.

## Where data is stored

Your edits exist only in the browser tab's memory and in the `.md` file on your
computer. If you close the tab, unsaved edits are lost. The theme choice (Auto /
Light / Dark) is not stored and resets for every tab.

The only thing numenumd itself stores in the browser is **the remembered save
target**.

- For each file saved successfully, it records in the browser's IndexedDB the
  permission to write to that file (a reference issued by the browser) and the
  file's modification time right after the last save.
- This is used only so that you don't have to pick the save location again each
  time you reopen the tab.
- **The text is never recorded.** The record says _which file_, not _what is
  written in it_.
- The record exists only in your browser and is never sent anywhere.
- **You can delete it at any time.** In the "⋯" menu at the top right of the
  editor, choose "記憶した保存先を消す" (forget remembered save locations) to
  delete every remembered save target. Clearing the browser's site data also
  deletes it.

Separately, **the browser itself** may keep the following. numenumd can't read
or write either of them, but they are listed here because using numenumd does
not leave _nothing_ behind.

- The folder you last used in the file save picker (so it opens there next
  time)
- The record that you allowed writing to a file (if you chose "Allow on every
  visit" in the permission prompt)

### Other local pages may be able to read this record

The browser treats every page opened with `file://` as **one shared storage
area**. numenumd's record lives there too, so the following is technically
possible:

> If you open **another HTML file saved on your computer** in Chrome, that page
> can read **the list of `.md` files you saved with numenumd (their absolute
> paths)**.

Reading a file's **contents** needs your permission each time, but **the list of
paths does not**. Paths can include your user name and folder structure.

This is how browsers treat `file://` pages in general, not a design choice of
numenumd. But since numenumd chose to remember save targets, we consider it our
responsibility and state it here.

If this concerns you, you can:

- Delete the record at any time from "⋯" → "記憶した保存先を消す" at the top
  right of the editor. After that, the next save opens the file save picker
  again.
- Avoid opening HTML files of unknown origin via `file://` (good advice for
  local pages in general, not just for this record).

## Permissions

The only permission numenumd requests is host access for pages matching
`file:///*`. It is used only to read local `.md` files and show them in the
editor.

This access is off by default. Unless you explicitly turn on **Allow access to
file URLs** for numenumd in Chrome's extensions page (`chrome://extensions`),
numenumd cannot access any file.

## Sharing with third parties

Since no data is collected, there is no data to share with third parties.
numenumd also doesn't load any external library over the network (all code it
depends on is bundled in the extension package).

## Contact

For questions about this policy, please open an issue in the GitHub repository:

https://github.com/tomoyahiroe/numenumd/issues
