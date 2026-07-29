// Browser bridge for Archive Model export.
// Injected after provider handlers and before init() in generated browser builds.

(function attachArchiveRuntime(global) {
    'use strict';

    const BUTTON_ATTRIBUTE = 'data-loominary-archive-export';

    function archiveLabel() {
        try {
            return i18n.currentLang === 'zh' ? '导出 Archive ZIP' : 'Export Archive ZIP';
        } catch (_) {
            return 'Export Archive ZIP';
        }
    }

    function includeImagesEnabled() {
        try {
            const toggle = document.getElementById(Config.IMAGE_SWITCH_ID);
            return toggle ? !!toggle.checked : !!State.includeImages;
        } catch (_) {
            return false;
        }
    }

    async function currentPayload(platform) {
        if (platform === 'chatgpt') {
            const conversationId = ChatGPTHandler.getCurrentConversationId();
            if (!conversationId) throw new Error(i18n.t('uuidNotFound'));
            return ChatGPTHandler.getConversation(conversationId, includeImagesEnabled());
        }

        if (platform === 'claude') {
            const uuid = ClaudeHandler.getCurrentUUID();
            if (!uuid) throw new Error(i18n.t('uuidNotFound'));
            if (!await ClaudeHandler.ensureUserId()) throw new Error(i18n.t('uuidNotFound'));
            const [data, meta] = await Promise.all([
                ClaudeHandler.getConversation(uuid, includeImagesEnabled()),
                typeof ClaudeHandler.getConversationMeta === 'function'
                    ? ClaudeHandler.getConversationMeta(uuid)
                    : Promise.resolve(null)
            ]);
            if (meta && data) {
                if (meta.project_uuid) data.project_uuid = meta.project_uuid;
                if (meta.project) data.project = meta.project;
            }
            return data;
        }

        if (platform === 'grok') {
            const conversationId = GrokHandler.getCurrentConversationId();
            if (!conversationId) throw new Error(i18n.t('uuidNotFound'));
            return GrokHandler.getConversation(conversationId);
        }

        if (platform === 'gemini' || platform === 'aistudio') {
            const handler = ScraperHandler.handlers[platform];
            if (!handler) throw new Error(`Unsupported platform: ${platform}`);
            const title = handler.getTitle();
            if (!title) throw new Error(i18n.t('noContent'));
            return ScraperHandler.buildConversationJson(platform, title);
        }

        throw new Error(`Unsupported platform: ${platform || 'unknown'}`);
    }

    function appendArchiveButton(controls, platform) {
        if (!controls || controls.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
        if (!['chatgpt', 'claude', 'grok', 'gemini', 'aistudio'].includes(platform)) return;

        const button = Utils.createButton(
            `${zipIcon} ${archiveLabel()}`,
            async btn => {
                const original = btn.innerHTML;
                Utils.setButtonLoading(btn, i18n.t('exporting'));
                try {
                    const payload = await currentPayload(platform);
                    if (!payload) throw new Error(i18n.t('fetchFailed'));
                    await Runtime.downloadBundle(payload);
                    if (State.showToast) State.showToast(i18n.t('exportSuccess'), 'success');
                } catch (error) {
                    if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handle) {
                        ErrorHandler.handle(error, 'Archive ZIP export');
                    } else {
                        console.error('[Loominary] Archive ZIP export failed:', error);
                        alert(error.message || String(error));
                    }
                } finally {
                    Utils.restoreButton(btn, original);
                }
            },
            platform === 'gemini'
        );
        button.setAttribute(BUTTON_ATTRIBUTE, platform);
        controls.appendChild(button);
    }

    function patchHandler(handler, platform) {
        if (!handler || typeof handler.addButtons !== 'function' || handler.addButtons.__archivePatched) return;
        const original = handler.addButtons;
        const patched = function(controls, ...args) {
            const result = original.call(this, controls, ...args);
            appendArchiveButton(controls, platform);
            return result;
        };
        patched.__archivePatched = true;
        handler.addButtons = patched;
    }

    function installButtons() {
        try {
            if (typeof ChatGPTHandler !== 'undefined') patchHandler(ChatGPTHandler, 'chatgpt');
            if (typeof ClaudeHandler !== 'undefined') patchHandler(ClaudeHandler, 'claude');
            if (typeof GrokHandler !== 'undefined') patchHandler(GrokHandler, 'grok');

            if (
                typeof ScraperHandler !== 'undefined' &&
                typeof ScraperHandler.addButtons === 'function' &&
                !ScraperHandler.addButtons.__archivePatched
            ) {
                const original = ScraperHandler.addButtons;
                const patched = function(controls, platform, ...args) {
                    const result = original.call(this, controls, platform, ...args);
                    appendArchiveButton(controls, platform);
                    return result;
                };
                patched.__archivePatched = true;
                ScraperHandler.addButtons = patched;
            }
        } catch (error) {
            console.error('[Loominary] Failed to install Archive ZIP buttons:', error);
        }
    }

    const Runtime = {
        version: 'archive-runtime/v3',

        async exportRecord(record, options = {}) {
            if (!record || typeof record !== 'object') {
                throw new TypeError('Archive record is required');
            }
            if (typeof global.LoominaryArchiveExport === 'function') {
                return global.LoominaryArchiveExport(record, options);
            }
            throw new Error('Archive export engine is not attached');
        },

        async downloadBundle(processedData, options = {}) {
            if (typeof global.LoominaryArchiveBundle !== 'function') {
                throw new Error('Archive bundle engine is not attached');
            }
            const result = await global.LoominaryArchiveBundle(processedData, options);
            const blob = new Blob([result.bytes], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = result.filename || 'conversation.zip';
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return result;
        },

        attach(exporter) {
            if (typeof exporter !== 'function') throw new TypeError('Exporter must be a function');
            global.LoominaryArchiveExport = exporter;
        },

        attachBundle(exporter) {
            if (typeof exporter !== 'function') throw new TypeError('Bundle exporter must be a function');
            global.LoominaryArchiveBundle = exporter;
        },

        installButtons
    };

    global.LoominaryArchiveRuntime = Runtime;
    installButtons();
})(typeof unsafeWindow !== 'undefined'
    ? unsafeWindow
    : typeof window !== 'undefined'
        ? window
        : globalThis);
