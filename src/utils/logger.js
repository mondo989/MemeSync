const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

class Logger {
    static info(message, data = null) {
        const timestamp = new Date().toISOString();
        console.log(`${colors.cyan}[${timestamp}] INFO:${colors.reset} ${message}`);
        if (data) {
            console.log(data);
        }
    }

    static success(message, data = null) {
        const timestamp = new Date().toISOString();
        console.log(`${colors.green}[${timestamp}] SUCCESS:${colors.reset} ${message}`);
        if (data) {
            console.log(data);
        }
    }

    static warn(message, data = null) {
        const timestamp = new Date().toISOString();
        console.warn(`${colors.yellow}[${timestamp}] WARN:${colors.reset} ${message}`);
        if (data) {
            console.warn(data);
        }
    }

    static error(message, error = null) {
        const timestamp = new Date().toISOString();
        console.error(`${colors.red}[${timestamp}] ERROR:${colors.reset} ${message}`);
        if (error) {
            console.error(error);
        }
    }

    static debug(message, data = null) {
        if (process.env.NODE_ENV === 'development') {
            const timestamp = new Date().toISOString();
            console.log(`${colors.dim}[${timestamp}] DEBUG:${colors.reset} ${message}`);
            if (data) {
                console.log(data);
            }
        }
    }
}

module.exports = Logger; 