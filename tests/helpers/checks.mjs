/**
 * A deliberately small assertion collector.
 *
 * A suite keeps running after a failed check and reports everything at the end,
 * because these are end-to-end browser tests: stopping at the first failure
 * hides whether one thing broke or the whole page did, which is exactly the
 * distinction most of these suites exist to make.
 */

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

const colour = (code, text) => (process.stdout.isTTY ? `${code}${text}${RESET}` : text);

export class Checks {
    constructor(suiteName) {
        this.suiteName = suiteName;
        this.passed = 0;
        this.failures = [];
        this.group = null;
    }

    /** Starts a labelled group of related checks. */
    describe(title) {
        this.group = title;
        console.log(`  ${title}`);
    }

    /**
     * @param {string} label What is being asserted, phrased as the desired state.
     * @param {boolean} condition
     * @param {*} [actual] Included in the failure message when it helps.
     */
    check(label, condition, actual) {
        if (condition) {
            this.passed++;
            console.log(`    ${colour(GREEN, '✓')} ${label}`);
            return true;
        }

        const detail = actual === undefined ? '' : ` ${colour(DIM, `got ${format(actual)}`)}`;
        console.log(`    ${colour(RED, '✗')} ${label}${detail}`);
        this.failures.push(this.group ? `${this.group} → ${label}` : label);
        return false;
    }

    /** Deep-equality check, for when the value is worth showing on failure. */
    equal(label, actual, expected) {
        return this.check(label, format(actual) === format(expected), actual);
    }
}

function format(value) {
    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(value);
    }
}
