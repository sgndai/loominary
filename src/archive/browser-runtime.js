// Browser bridge for Archive Model export.
// Archive integration keeps the original platform handlers and only augments
// the existing ChatGPT export row without adding another sidebar row.

(function attachArchiveRuntime(global) {
    'use strict';

    function isChinese() {
        return typeof i18n !== 'undefined' && i18n.currentLang === 'zh';
    }

    function addUiStyles() {
        if (typeof document === 'undefined' || document.getElementById('loominary-archive-ui-style')) return;

        const css = `
            #loominary-controls {
                box-sizing: border-box !important;
                width: 168px !important;
                right: 12px !important;
                transform: translateY(-50%) !important;
            }

            #loominary-controls.collapsed {
                width: 32px !important;
                height: 32px !important;
                padding: 0 !important;
                right: 12px !important;
                transform: translateY(-50%) !important;
                background: transparent !important;
                border: 0 !important;
                border-radius: 50% !important;
                box-shadow: none !important;
                opacity: 1 !important;
                pointer-events: auto !important;
                overflow: visible !important;
            }

            #loominary-controls.collapsed .loominary-main-controls {
                display: none !important;
            }

            #loominary-controls.collapsed #loominary-toggle-button {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 32px !important;
                height: 32px !important;
                transform: none !important;
                border-radius: 50% !important;
                opacity: 1 !important;
                pointer-events: auto !important;
            }

            .loominary-export-row {
                display: grid !important;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
                gap: 6px !important;
                width: 100% !important;
                margin: 8px 0 !important;
            }

            .loominary-export-row .loominary-button {
                min-width: 0 !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 8px 5px !important;
                justify-content: center !important;
                gap: 3px !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                letter-spacing: 0 !important;
                font-size: 10px !important;
            }
        `;

        const style = document.createElement('style');
        style.id = 'loominary-archive-ui-style';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    const Runtime = {
        version: 'archive-runtime/v5',

        async exportRecord(record, options = {}) {
            if (!record || typeof record !== 'object') {
                throw new TypeError('Archive record is required');
            }
            if (typeof global.LoominaryArchiveExport === 'function') {
                return global.LoominaryArchiveExport(record, options);
            }
            throw new Error('Archive export engine is not attached');
        },

        async createBundle(processedData, options = {}) {
            if (typeof global.LoominaryArchiveBundle !== 'function') {
                throw new Error('Archive bundle engine is not attached');
            }
            return global.LoominaryArchiveBundle(processedData, options);
        },

        async downloadBundle(processedData, options = {}) {
            const result = await Runtime.createBundle(processedData, options);
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

        async exportCurrentChatgptArchive(button) {
            if (typeof global.LoominaryArchiveCollectCurrent !== 'function') {
                throw new Error('ChatGPT Archive collector is not attached');
            }

            const original = button?.innerHTML || '';
            if (button && typeof Utils !== 'undefined') {
                Utils.setButtonLoading(button, isChinese() ? '备份中' : 'Backing up');
            }

            try {
                const input = await global.LoominaryArchiveCollectCurrent('chatgpt', {
                    includeImages: true
                });
                const result = await Runtime.downloadBundle(input, {
                    assetReport: input.assetReport
                });
                const integrity = result?.manifest?.integrity;

                if (integrity?.status === 'partial') {
                    const message = isChinese()
                        ? `完整备份已生成，但有 ${integrity.failed} 个附件下载失败。请查看 ZIP 内的 README.md 和 manifest.json。`
                        : `The backup was created, but ${integrity.failed} attachment(s) failed to download. See README.md and manifest.json in the ZIP.`;
                    alert(message);
                }

                return result;
            } catch (error) {
                if (typeof ErrorHandler !== 'undefined' && typeof ErrorHandler.handle === 'function') {
                    ErrorHandler.handle(error, 'Export complete backup');
                    return null;
                }
                throw error;
            } finally {
                if (button && typeof Utils !== 'undefined') {
                    Utils.restoreButton(button, original);
                }
            }
        },

        attach(exporter) {
            if (typeof exporter !== 'function') throw new TypeError('Exporter must be a function');
            global.LoominaryArchiveExport = exporter;
        },

        attachBundle(exporter) {
            if (typeof exporter !== 'function') throw new TypeError('Bundle exporter must be a function');
            global.LoominaryArchiveBundle = exporter;
        }
    };

    function installChatgptExportRow() {
        if (
            typeof ChatGPTHandler === 'undefined' ||
            typeof Utils === 'undefined' ||
            typeof ChatGPTHandler.addButtons !== 'function' ||
            ChatGPTHandler.__loominaryArchiveUiPatched
        ) {
            return;
        }

        const originalAddButtons = ChatGPTHandler.addButtons;
        ChatGPTHandler.addButtons = function addButtonsWithArchive(controls) {
            originalAddButtons.call(ChatGPTHandler, controls);

            const directButtons = Array.from(controls.children)
                .filter(element => element.classList?.contains('loominary-button'));
            const jsonButton = directButtons[1];
            if (!jsonButton || jsonButton.closest('.loominary-export-row')) return;

            const row = document.createElement('div');
            row.className = 'loominary-export-row';
            jsonButton.parentNode.insertBefore(row, jsonButton);
            row.appendChild(jsonButton);

            jsonButton.textContent = isChinese() ? '当前 JSON' : 'Current JSON';
            jsonButton.title = isChinese()
                ? '保留原作者的当前对话 JSON 导出'
                : 'Export the current conversation as the original JSON format';

            const archiveButton = Utils.createButton(
                isChinese() ? '完整备份' : 'Full backup',
                button => Runtime.exportCurrentChatgptArchive(button)
            );
            archiveButton.title = isChinese()
                ? '导出对话 Markdown、结构化 JSON、图片和上传文件'
                : 'Export Markdown, structured JSON, images, and uploaded files';
            row.appendChild(archiveButton);
        };

        ChatGPTHandler.__loominaryArchiveUiPatched = true;
    }

    addUiStyles();
    installChatgptExportRow();
    global.LoominaryArchiveRuntime = Runtime;
})(typeof unsafeWindow !== 'undefined'
    ? unsafeWindow
    : typeof window !== 'undefined'
        ? window
        : globalThis);
