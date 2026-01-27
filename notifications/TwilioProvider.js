
/**
 * Twilio Provider (Stub)
 */
export class TwilioProvider {
    constructor(config = {}) {
        this.name = 'sms';
        this.config = config;
    }

    async send(to, content, metadata = {}) {
        if (!this.config.accountSid || !this.config.authToken) {
            console.warn('[TwilioProvider] Missing credentials. Simulating send.');
            console.log(`[TwilioStub] To: ${to} | Content: ${content}`);
            return { success: true, simulated: true };
        }

        // TODO: Implement real Twilio API call
        // const client = new Twilio(this.config.accountSid, this.config.authToken);
        // ...

        return { success: false, error: 'Not implemented' };
    }
}
