# Loominary Archive Model v1

## Purpose

Archive Model v1 is the canonical internal representation between provider parsers and all consumers.

The model separates:

- provider-specific raw data
- normalized conversation records
- derived indexes and views
- export/render formats

## Design principles

1. Provider identifiers remain metadata.
2. Loominary IDs are stable within an archive.
3. Rich blocks preserve information without forcing every consumer to understand every provider.
4. Human-readable projections are derived from structured records.

## Archive

```json
{
  "schemaVersion": "loominary.archive/v1",
  "archiveId": "archive-id",
  "conversations": [],
  "contexts": [],
  "annotations": {}
}
```

## Conversation

```json
{
  "schemaVersion": "loominary.conversation/v1",
  "conversation": {
    "id": "local-id",
    "title": "title",
    "platform": "chatgpt",
    "provider": "openai",
    "providerConversationId": "external-id",
    "createdAt": null,
    "updatedAt": null
  },
  "branches": [],
  "messages": []
}
```

## Message

```json
{
  "id": "message-id",
  "parentId": null,
  "branchId": "main",
  "role": "assistant",
  "createdAt": null,
  "text": "plain text projection",
  "content": [
    {
      "type": "text",
      "text": "typed content block"
    }
  ],
  "attachments": [],
  "citations": [],
  "thinking": null,
  "toolCalls": []
}
```

## Typed content blocks

Supported initial block types:

- text
- markdown
- code
- image
- file
- citation
- tool-call
- tool-result
- thinking

Unknown blocks remain preserved as:

```json
{
  "type": "unknown",
  "raw": {}
}
```

## Attachment

```json
{
  "id": "file-id",
  "name": "file.pdf",
  "mimeType": "application/pdf",
  "size": 0,
  "source": "provider",
  "location": null
}
```

## Citation

```json
{
  "type": "url",
  "url": "https://example.com",
  "title": "Example",
  "matchedText": "quoted text",
  "sourceType": "web"
}
```

## Tool call

```json
{
  "name": "web_search",
  "input": {},
  "result": {},
  "createdAt": null
}
```

## Context

Context remains separate from messages.

Includes:

- project metadata
- instructions
- memories
- knowledge files

## Migration rule

Existing parser output can continue to exist during migration.

Migration path:

```
provider parser
    -> normalized adapter
    -> Archive Model v1
    -> viewer/export/search
```
