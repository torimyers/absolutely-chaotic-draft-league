class LearningManager {
    constructor() {
        this.conceptsLearned = parseInt(localStorage.getItem('conceptsLearned') || '0');
        this.totalConcepts = 25;
        this.updateProgress();
    }

    updateProgress() {
        document.getElementById('conceptsLearned').textContent = this.conceptsLearned;
        const percentage = (this.conceptsLearned / this.totalConcepts) * 100;
        document.getElementById('progressFill').style.width = `${percentage}%`;
        
        // Update compact progress indicators
        for (let i = 1; i <= 5; i++) {
            const compactElement = document.getElementById(`compactConceptsLearned${i}`);
            const compactFill = document.getElementById(`compactProgressFill${i}`);
            if (compactElement) {
                compactElement.textContent = this.conceptsLearned;
            }
            if (compactFill) {
                compactFill.style.width = `${percentage}%`;
            }
        }
        
        const mainCompactElement = document.getElementById('compactConceptsLearned');
        const mainCompactFill = document.getElementById('compactProgressFill');
        if (mainCompactElement) {
            mainCompactElement.textContent = this.conceptsLearned;
        }
        if (mainCompactFill) {
            mainCompactFill.style.width = `${percentage}%`;
        }
    }

    learnConcept() {
        if (this.conceptsLearned < this.totalConcepts) {
            this.conceptsLearned++;
            localStorage.setItem('conceptsLearned', this.conceptsLearned.toString());
            this.updateProgress();
            
            // Show achievement notification
            configManager.showNotification(`New concept learned! Progress: ${this.conceptsLearned}/${this.totalConcepts}`, 'success');
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LearningManager;
}