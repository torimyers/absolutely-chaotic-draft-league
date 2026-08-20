class NavigationManager {
    constructor() {
        this.currentPage = 'dashboard';
        this.setupNavigation();
        this.setupMobileToggle();
        this.setupDeepLinking();
    }

    // Pages reachable from the sidebar - also the allow-list for deep links, so a
    // bogus ?page= or #hash can't blank the app by activating a non-existent page.
    getValidPages() {
        return Array.from(document.querySelectorAll('.nav-link[data-page]'))
            .map(link => link.getAttribute('data-page'));
    }

    // Supports the PWA manifest shortcuts (./?page=live-draft), plain #hash links,
    // and the browser back/forward buttons.
    setupDeepLinking() {
        const params = new URLSearchParams(window.location.search);
        const requested = params.get('page') || window.location.hash.replace('#', '');

        if (requested && this.getValidPages().includes(requested)) {
            this.navigateToPage(requested);
        }

        window.addEventListener('hashchange', () => {
            const page = window.location.hash.replace('#', '');
            if (page && page !== this.currentPage && this.getValidPages().includes(page)) {
                this.navigateToPage(page);
            }
        });
    }

    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.getAttribute('data-page');
                this.navigateToPage(page);
            });
        });
    }

    navigateToPage(page) {
        const target = document.getElementById(page);
        const navLink = document.querySelector(`[data-page="${page}"]`);

        if (!target || !navLink) {
            console.warn(`NavigationManager: unknown page "${page}"`);
            return;
        }

        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        navLink.classList.add('active');

        // Show/hide page content
        document.querySelectorAll('.page-content').forEach(content => {
            content.classList.remove('active');
        });
        target.classList.add('active');

        this.currentPage = page;

        // Keep the URL in step so the page can be linked to, bookmarked and
        // reached with the back button.
        if (window.location.hash.replace('#', '') !== page) {
            window.location.hash = page;
        }

        // Close mobile menu if open
        document.getElementById('sidebar').classList.remove('mobile-visible');
    }

    setupMobileToggle() {
        const mobileToggle = document.getElementById('mobileToggle');
        const sidebar = document.getElementById('sidebar');

        mobileToggle.addEventListener('click', () => {
            sidebar.classList.toggle('mobile-visible');
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!sidebar.contains(e.target) && !mobileToggle.contains(e.target)) {
                sidebar.classList.remove('mobile-visible');
            }
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigationManager;
}