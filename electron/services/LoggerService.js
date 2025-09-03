const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');
const winston = require('winston');

class LoggerService {
  constructor() {
    const userData = app.getPath('userData');
    this.logDir = path.join(userData, 'logs');
    fs.ensureDirSync(this.logDir);

    const isDev = process.env.NODE_ENV === 'development';
    const transports = [
      new winston.transports.File({ filename: path.join(this.logDir, 'error.log'), level: 'error' }),
      new winston.transports.File({ filename: path.join(this.logDir, 'app.log') }),
    ];
    if (isDev) {
      transports.push(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }));
    }

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports,
    });
  }

  info(message, meta={}) { this.logger.info(message, meta); }
  warn(message, meta={}) { this.logger.warn(message, meta); }
  error(message, meta={}) { this.logger.error(message, meta); }
}

module.exports = { LoggerService };


