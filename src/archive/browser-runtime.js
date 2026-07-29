// Browser bridge for Archive Model export.
// The build pipeline injects this after provider handlers in a later integration step.
// This file intentionally exposes a small global API and keeps browser code separate
// from Archive Model implementation.

(function attachArchiveRuntime(global) {
    'use strict';

    const Runtime = {
        version: 'archive-runtime/v1',

        async exportRecord(record, options = {}) {
            if (!record || typeof record !== 'object') {
                throw new TypeError('Archive record is required');
            }

            if (typeof global.LoominaryArchiveExport === 'function') {
                return global.LoominaryArchiveExport(record, options);
            }

            throw new Error('Archive export engine is not attached');
        },

        attach(exporter) {
            if (typeof exporter !== 'function') {
                throw new TypeError('Exporter must be a function');
            }
            global.LoominaryArchiveExport = exporter;
        }
    };

    global.LoominaryArchiveRuntime = Runtime;
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
