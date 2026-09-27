# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately through GitHub's
[private vulnerability reporting](https://github.com/tomoyahiroe/numenumd/security/advisories/new).
You'll get a reply as soon as the maintainer can look at it. This is a
personal project, so there is no guaranteed response time.

## Scope

numenumd runs as a content script on local `file://` pages whose path ends in
`.md`, reads the open file, and writes it back only through the File System
Access API after you choose a save location. Reports about reading or writing
files the user did not choose, executing content from a Markdown file, or
leaking the remembered save locations are especially welcome.

## Supported versions

Only the latest release is supported.
