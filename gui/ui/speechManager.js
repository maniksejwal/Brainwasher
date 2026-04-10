/**
 * @fileoverview Speech Utilities
 * Speech-to-Text (STT) and Text-to-Speech (TTS) functionality
 */

export class SpeechManager {
    constructor() {
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isListening = false;
        this.isSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
        
        if (this.isSupported) {
            const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.setupRecognition();
        }
    }

    setupRecognition() {
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            this.onTranscriptUpdate(finalTranscript, interimTranscript);
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.onError(event.error);
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.onStop();
        };
    }

    // Override these methods in implementation
    onTranscriptUpdate(finalText, interimText) {
        // Override this method
    }

    onError(error) {
        // Override this method
    }

    onStop() {
        // Override this method
    }

    startListening() {
        if (!this.isSupported) {
            alert('Speech recognition is not supported in this browser.');
            return false;
        }

        if (this.isListening) {
            return false;
        }

        this.recognition.start();
        this.isListening = true;
        return true;
    }

    stopListening() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }

    speak(text, options = {}) {
        if (!this.synthesis) {
            console.error('Text-to-speech not supported');
            return;
        }

        // Cancel any ongoing speech
        this.synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = options.rate || 1.0;
        utterance.pitch = options.pitch || 1.0;
        utterance.volume = options.volume || 1.0;
        utterance.lang = options.lang || 'en-US';

        if (options.voice) {
            utterance.voice = options.voice;
        }

        utterance.onend = () => {
            if (options.onEnd) options.onEnd();
        };

        utterance.onerror = (event) => {
            console.error('Speech synthesis error:', event.error);
            if (options.onError) options.onError(event.error);
        };

        this.synthesis.speak(utterance);
    }

    stopSpeaking() {
        if (this.synthesis) {
            this.synthesis.cancel();
        }
    }

    getVoices() {
        return this.synthesis ? this.synthesis.getVoices() : [];
    }
}

// Chat Speech Manager
export class ChatSpeechManager extends SpeechManager {
    constructor(chatInput) {
        super();
        this.chatInput = chatInput;
        this.statusIndicator = null;
        this.createUI();
    }

    createUI() {
        // Create STT button for chat
        const inputContainer = this.chatInput.closest('.input-container');
        if (inputContainer) {
            const sttButton = document.createElement('button');
            sttButton.className = 'speech-btn stt-btn';
            sttButton.innerHTML = '🎤';
            sttButton.title = 'Speech to Text';
            sttButton.addEventListener('click', () => this.toggleListening());

            const ttsButton = document.createElement('button');
            ttsButton.className = 'speech-btn tts-btn';
            ttsButton.innerHTML = '🔊';
            ttsButton.title = 'Read Last Message';
            ttsButton.addEventListener('click', () => this.speakLastMessage());

            inputContainer.appendChild(sttButton);
            inputContainer.appendChild(ttsButton);

            this.sttButton = sttButton;
            this.ttsButton = ttsButton;
        }
    }

    toggleListening() {
        if (this.isListening) {
            this.stopListening();
        } else {
            if (this.startListening()) {
                this.sttButton.innerHTML = '⏹️';
                this.sttButton.classList.add('listening');
                this.chatInput.placeholder = 'Listening... (speak now)';
            }
        }
    }

    onTranscriptUpdate(finalText, interimText) {
        if (finalText) {
            const currentValue = this.chatInput.value;
            this.chatInput.value = currentValue + finalText + ' ';
            this.chatInput.focus();
        }
    }

    onStop() {
        this.sttButton.innerHTML = '🎤';
        this.sttButton.classList.remove('listening');
        this.chatInput.placeholder = 'Type a message or use voice...';
    }

    onError(error) {
        this.onStop();
        console.error('Speech recognition error in chat:', error);
    }

    speakLastMessage() {
        const messages = document.querySelectorAll('.message.agent');
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            const text = lastMessage.textContent;
            this.speak(text, {
                onEnd: () => {
                    this.ttsButton.classList.remove('speaking');
                }
            });
            this.ttsButton.classList.add('speaking');
        }
    }
}

// Document Speech Manager
export class DocumentSpeechManager extends SpeechManager {
    constructor(textArea) {
        super();
        this.textArea = textArea;
        this.createUI();
    }

    createUI() {
        // Find or create toolbar for document editor
        let toolbar = document.querySelector('.editor-toolbar .toolbar-left');
        if (!toolbar) {
            // Create simple toolbar if it doesn't exist
            const editorArea = this.textArea.closest('.editor-area') || this.textArea.parentElement;
            const toolbarDiv = document.createElement('div');
            toolbarDiv.className = 'speech-toolbar';
            toolbarDiv.style.cssText = 'margin-bottom: 8px; display: flex; gap: 8px;';
            editorArea.insertBefore(toolbarDiv, this.textArea);
            toolbar = toolbarDiv;
        }

        const sttButton = document.createElement('button');
        sttButton.className = 'tool-btn speech-btn';
        sttButton.innerHTML = '🎤 Dictate';
        sttButton.title = 'Speech to Text';
        sttButton.addEventListener('click', () => this.toggleListening());

        const ttsButton = document.createElement('button');
        ttsButton.className = 'tool-btn speech-btn';
        ttsButton.innerHTML = '🔊 Read';
        ttsButton.title = 'Read Document';
        ttsButton.addEventListener('click', () => this.readDocument());

        toolbar.appendChild(sttButton);
        toolbar.appendChild(ttsButton);

        this.sttButton = sttButton;
        this.ttsButton = ttsButton;
    }

    toggleListening() {
        if (this.isListening) {
            this.stopListening();
        } else {
            if (this.startListening()) {
                this.sttButton.innerHTML = '⏹️ Stop';
                this.sttButton.classList.add('listening');
            }
        }
    }

    onTranscriptUpdate(finalText, interimText) {
        if (finalText) {
            const cursorPos = this.textArea.selectionStart;
            const textBefore = this.textArea.value.substring(0, cursorPos);
            const textAfter = this.textArea.value.substring(cursorPos);
            this.textArea.value = textBefore + finalText + ' ' + textAfter;
            
            // Move cursor to end of inserted text
            const newPos = cursorPos + finalText.length + 1;
            this.textArea.setSelectionRange(newPos, newPos);
            this.textArea.focus();
            
            // Trigger input event for live preview
            this.textArea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    onStop() {
        this.sttButton.innerHTML = '🎤 Dictate';
        this.sttButton.classList.remove('listening');
    }

    onError(error) {
        this.onStop();
        console.error('Speech recognition error in document editor:', error);
    }

    readDocument() {
        const text = this.textArea.value;
        if (!text.trim()) {
            this.speak('The document is empty.');
            return;
        }

        // Convert markdown to more readable text
        const readableText = text
            .replace(/^#+\s*/gm, '') // Remove markdown headers
            .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
            .replace(/\*(.*?)\*/g, '$1') // Remove italic
            .replace(/`(.*?)`/g, '$1') // Remove code
            .replace(/^\-\s*/gm, '') // Remove list markers
            .trim();

        this.speak(readableText, {
            onEnd: () => {
                this.ttsButton.classList.remove('speaking');
            }
        });
        
        this.ttsButton.classList.add('speaking');
        this.ttsButton.innerHTML = '⏹️ Stop';
        
        // Add stop functionality
        this.ttsButton.onclick = () => {
            this.stopSpeaking();
            this.ttsButton.classList.remove('speaking');
            this.ttsButton.innerHTML = '🔊 Read';
            this.ttsButton.onclick = () => this.readDocument();
        };
    }
}

// Auto-initialize speech for existing elements
export function initializeSpeech() {
    // Initialize chat speech
    const chatInput = document.getElementById('user-input');
    if (chatInput) {
        new ChatSpeechManager(chatInput);
    }

    // Initialize document speech when markdown editor is available
    const markdownEditor = document.getElementById('markdown-editor');
    if (markdownEditor) {
        new DocumentSpeechManager(markdownEditor);
    }
}