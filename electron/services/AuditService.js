const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

class AuditService {
  constructor() {
    const userData = app.getPath('userData');
    this.auditDir = path.join(userData, 'audit');
    fs.ensureDirSync(this.auditDir);
    this.filePath = path.join(this.auditDir, 'audit.log.jsonl');
  }

  write(event, data={}) {
    const line = JSON.stringify({ ts: Date.now(), event, ...data }) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
  }
}

module.exports = { AuditService };


