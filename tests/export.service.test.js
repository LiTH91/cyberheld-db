const fs = require('fs-extra');
const path = require('path');

describe('ExportService (HTML content)', () => {
  let ExportService;
  let svc;

  beforeAll(() => {
    jest.resetModules();
    ExportService = require('../electron/services/ExportService').ExportService;
    svc = new ExportService();
  });

  test('buildHtmlReport contains checksum when present', () => {
    const post = { id: 'p1', title: 'T', url: 'http://x' };
    const comments = [
      { id: 'c1', metadata: JSON.stringify({ profileName: 'A', date: new Date().toISOString(), text: 'hello', likesCount: 1, commentsCount: 0 }), checksum_screenshot: 'a'.repeat(64) },
    ];
    const html = svc.buildHtmlReport(post, comments);
    expect(html).toContain('Checksum (SHA256)');
    expect(html).toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
});


