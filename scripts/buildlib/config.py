"""Static platform and mirror configuration for Loominary builds."""

CLAUDE_MIRRORS = [
    # 'https://claude.rent',
]

PLATFORMS = {
    'claude': {
        'name': 'Claude',
        'matches': [
            'https://claude.ai/*'
        ]
    },
    'chatgpt': {
        'name': 'ChatGPT',
        'matches': [
            'https://chatgpt.com/*',
            'https://chat.openai.com/*'
        ]
    },
    'grok': {
        'name': 'Grok',
        'matches': [
            'https://grok.com/*'
        ],
        'image_hosts': [
            '*://*.grok.com/*',
        ]
    },
    'copilot': {
        'name': 'Copilot',
        'matches': [
            'https://copilot.microsoft.com/*'
        ],
        'connect': [
            'copilot.microsoft.com',
            'bing.com',
            'r.bing.com',
            'edgeservices.bing.com'
        ]
    },
    'gemini': {
        'name': 'Gemini',
        'matches': [
            'https://gemini.google.com/*',
            'https://aistudio.google.com/*'
        ],
        'includes': [
            '*://gemini.google.com/*',
            '*://aistudio.google.com/*'
        ]
    }
}

PLATFORM_DESCRIPTIONS = {
    'claude': {
        'name': 'Loominary for Claude',
        'name_zh': '全功能Claude对话跨分支全局搜索文档PDF长截图导出管理工具',
        'desc': 'One-click export for Claude. Backups all chat branches, artifacts, and attachments. Exports to JSON/Markdown/PDF/Editable Screenshots.',
        'desc_zh': '一键导出 Claude 对话记录（支持分支、PDF、长截图）。保留完整对话分支、附加图片、LaTeX 公式、Artifacts、附件与思考过程。',
    },
}

USERSCRIPT_PLATFORMS = ['claude', 'chatgpt', 'grok', 'gemini']
