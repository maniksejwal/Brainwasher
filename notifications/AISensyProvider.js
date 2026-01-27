
/**
 * AISensy Provider (Stub) - WhatsApp
 */
export class AISensyProvider {
    constructor(config = {}) {
        this.name = 'whatsapp';
        this.config = config;
    }

    async send(to, content, metadata = {}) {
        if (!this.config.apiKey) {
            console.warn('[AISensyProvider] Missing API key. Simulating send.');
            console.log(`[WhatsAppStub] To: ${to} | Content: ${content}`);
            return { success: true, simulated: true };
        }

        // TODO: Implement real AISensy API call
        // const response = await fetch(...)

        return { success: false, error: 'Not implemented' };
    }
}
