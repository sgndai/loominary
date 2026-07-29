# Provider Adapter Migration v1

## Goal

Move provider-specific parser output into Archive Model v1 without rewriting every parser at once.

## Flow

```text
Provider Parser
      |
      v
Provider Adapter
      |
      v
loominary.conversation/v1
      |
      v
Viewer / Search / Export
```

## Migration order

1. ChatGPT
   - mapping tree
   - citations
   - attachments
   - thinking
   - tool calls

2. Claude
   - branches
   - artifacts
   - attachments
   - project context

3. Gemini / Grok
   - platform-specific fields mapped into metadata

## Rule

Historical parser output remains available during migration. The adapter layer is the only place where provider fields become canonical Archive Model fields.
