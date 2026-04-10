/**
 * @fileoverview Document Workspace UI
 * Interactive document editing interface matching CLI functionality
 */

// Markdown preview functionality
export function setupDocumentWorkspace() {
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('markdown-preview');
    const previewToggle = document.getElementById('preview-toggle');
    const saveBtn = document.getElementById('save-doc');
    const newDocBtn = document.getElementById('new-document-btn');
    
    let isPreviewMode = true;
    let currentDocId = 'welcome';
    let unsavedChanges = false;

    // Markdown to HTML conversion (simple version)
    function markdownToHtml(markdown) {
        if (!markdown.trim()) {
            return `<div class="welcome-content">
                <h1>📄 Document Workspace</h1>
                <p>Start typing to see your content rendered here...</p>
            </div>`;
        }
        
        let html = markdown
            // Headers
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // Code
            .replace(/`(.*?)`/g, '<code>$1</code>')
            // Lists
            .replace(/^\- (.*$)/gim, '<li>$1</li>')
            // Line breaks
            .replace(/\n/g, '<br>');
            
        // Wrap list items in ul
        html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
        
        return html;
    }

    // Live preview update
    if (editor && preview) {
        editor.addEventListener('input', () => {
            const markdown = editor.value;
            preview.innerHTML = markdownToHtml(markdown);
            unsavedChanges = true;
            updateSaveButton();
        });
    }

    // Preview toggle
    if (previewToggle) {
        previewToggle.addEventListener('click', () => {
            const previewPane = document.querySelector('.preview-pane');
            if (isPreviewMode) {
                previewPane.style.display = 'none';
                previewToggle.textContent = '👁️ Show Preview';
                isPreviewMode = false;
            } else {
                previewPane.style.display = 'block';
                previewToggle.textContent = '👁️ Hide Preview';
                isPreviewMode = true;
            }
        });
    }

    // Save document
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            if (!unsavedChanges) return;
            
            const content = editor.value;
            const title = extractTitle(content) || 'Untitled Document';
            
            try {
                // TODO: Implement actual save to DocumentAgent
                console.log('Saving document:', { title, content });
                
                // Simulate API call
                await new Promise(resolve => setTimeout(resolve, 500));
                
                unsavedChanges = false;
                updateSaveButton();
                showNotification('Document saved successfully! 💾', 'success');
                
            } catch (error) {
                console.error('Save error:', error);
                showNotification('Failed to save document 😞', 'error');
            }
        });
    }

    // New document
    if (newDocBtn) {
        newDocBtn.addEventListener('click', () => {
            if (unsavedChanges) {
                if (!confirm('You have unsaved changes. Continue without saving?')) {
                    return;
                }
            }
            
            // Clear editor
            editor.value = `# New Document

## Getting Started
Start writing your content here...

### Features Available:
- **Real-time markdown preview**
- *Collaborative editing*
- Approval workflows
- Version control

---

*Happy writing!* ✨`;
            
            // Update preview
            preview.innerHTML = markdownToHtml(editor.value);
            
            // Update tab
            updateActiveTab('New Document');
            
            currentDocId = 'new-' + Date.now();
            unsavedChanges = true;
            updateSaveButton();
        });
    }

    // Utility functions
    function extractTitle(content) {
        const match = content.match(/^#\s+(.+)/m);
        return match ? match[1] : null;
    }

    function updateSaveButton() {
        if (saveBtn) {
            if (unsavedChanges) {
                saveBtn.textContent = '💾 Save *';
                saveBtn.style.background = 'var(--green-50)';
                saveBtn.style.borderColor = 'var(--green-500)';
            } else {
                saveBtn.textContent = '💾 Saved';
                saveBtn.style.background = 'white';
                saveBtn.style.borderColor = 'var(--gray-300)';
            }
        }
    }

    function updateActiveTab(title) {
        const tabTitle = document.querySelector('.tab.active .tab-title');
        if (tabTitle) {
            tabTitle.textContent = `📄 ${title}`;
        }
    }

    function showNotification(message, type) {
        // Create simple notification
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'success' ? 'var(--green-50)' : 'var(--red-50)'};
            border: 1px solid ${type === 'success' ? 'var(--green-500)' : 'var(--red-500)'};
            border-radius: 6px;
            z-index: 1000;
            font-size: 14px;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Initialize with default content
    if (editor && !editor.value) {
        // Start with empty editor to show welcome message
        editor.value = '';
        preview.innerHTML = markdownToHtml('');
    }

    // Document search functionality
    const docSearch = document.getElementById('doc-search');
    if (docSearch) {
        docSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            // TODO: Implement document search
            console.log('Searching for:', searchTerm);
        });
    }

    // Document filter
    const docFilter = document.getElementById('doc-filter');
    if (docFilter) {
        docFilter.addEventListener('change', (e) => {
            const filterType = e.target.value;
            // TODO: Implement document filtering
            console.log('Filtering by:', filterType);
            loadDocuments(filterType);
        });
    }
}

// Load documents based on filter
async function loadDocuments(filter = 'all') {
    const listArea = document.getElementById('documents-list-area');
    if (!listArea) return;
    
    listArea.innerHTML = '<div class="loading">Loading documents...</div>';
    
    try {
        // TODO: Replace with actual API call
        // const response = await window.api.get(`/api/documents/user/${window.state.userId}?filter=${filter}`);
        
        // Mock data for now
        const mockDocuments = [
            {
                id: 'doc1',
                title: 'Project Proposal v2.1',
                author: 'alice',
                status: 'pending',
                updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
                version: '2.1'
            },
            {
                id: 'doc2', 
                title: 'Meeting Notes - Sprint Planning',
                author: 'bob',
                status: 'approved',
                updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
                version: '1.0'
            }
        ];
        
        renderDocumentList(mockDocuments);
        
    } catch (error) {
        console.error('Error loading documents:', error);
        listArea.innerHTML = '<div class="error">Failed to load documents</div>';
    }
}

function renderDocumentList(documents) {
    const listArea = document.getElementById('documents-list-area');
    if (!listArea) return;
    
    if (documents.length === 0) {
        listArea.innerHTML = `<div class="empty-docs">
            <p>No documents found.</p>
            <button onclick="document.getElementById('new-document-btn').click()">Create your first document</button>
        </div>`;
        return;
    }
    
    listArea.innerHTML = '';
    documents.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'document-list-item interactive';
        item.innerHTML = `
            <div class="doc-item-header">
                <h6>${doc.title}</h6>
                <div class="doc-item-actions">
                    <button class="mini-btn" onclick="editDocument('${doc.id}')" title="Edit">✏️</button>
                    <button class="mini-btn" onclick="shareDocument('${doc.id}')" title="Share">🔗</button>
                </div>
            </div>
            <div class="doc-item-meta">
                <span class="doc-author">@${doc.author}</span>
                <span class="doc-version">v${doc.version}</span>
                <span class="doc-status ${doc.status}">${doc.status}</span>
            </div>
            <div class="doc-item-date">${formatRelativeTime(doc.updated_at)}</div>
        `;
        
        // Click to open document
        item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('mini-btn')) {
                openDocument(doc);
            }
        });
        
        listArea.appendChild(item);
    });
}

// Document actions
window.editDocument = function(docId) {
    console.log('Edit document:', docId);
    // TODO: Load document content into editor
};

window.shareDocument = function(docId) {
    console.log('Share document:', docId);
    // TODO: Show share dialog
};

window.openDocument = function(doc) {
    console.log('Open document:', doc);
    // TODO: Load document content into editor
};

function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
}