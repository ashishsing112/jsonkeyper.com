/* Navbar collapse toggle.
   The only Bootstrap JS behaviour this site used was the responsive navbar,
   so this replaces jQuery + Popper + bootstrap.min.js on every page.
   Bootstrap's CSS still supplies .collapse / .show, we only flip the class. */
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-toggle="collapse"]').forEach(function (button) {
        const selector = button.getAttribute('data-target') || button.getAttribute('href');
        const target = selector && document.querySelector(selector);
        if (!target) {
            return;
        }
        button.addEventListener('click', function (event) {
            event.preventDefault();
            const open = target.classList.toggle('show');
            button.setAttribute('aria-expanded', String(open));
        });
    });
});
