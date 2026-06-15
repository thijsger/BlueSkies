import { el, toast } from "./util.js";
import { auth } from "./auth.js";

// Renders a full-screen login/register screen. Calls onAuthed(user) on success.
export async function renderLogin(container, onAuthed) {
  let mode = "login"; // or "register"
  let googleClientId = null;
  try { googleClientId = (await auth.config()).googleClientId; } catch {}

  const card = el("div", { class: "auth-card" });
  const root = el("div", { class: "auth-screen" }, [
    el("div", { class: "auth-bg" }),
    card,
  ]);
  container.innerHTML = "";
  container.append(root);

  function render() {
    card.innerHTML = "";
    card.append(
      el("div", { class: "auth-brand" }, [
        el("span", { class: "auth-logo", html: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a9 9 0 0 1 18 0"/><path d="M3 11 11 20"/><path d="M21 11 13 20"/><path d="M9 11l2 9"/><path d="M15 11l-2 9"/><path d="M11 20l1 2 1-2"/></svg>` }),
        el("div", { class: "auth-word" }, [el("b", {}, "Blue"), el("span", { class: "grad" }, "Skies")]),
      ]),
      el("h1", { class: "auth-title" }, mode === "login" ? "Inloggen" : "Account aanmaken"),
      el("p", { class: "auth-sub" }, mode === "login" ? "Welkom terug — log in om je logboek te zien." : "Maak een account om je sprongen op te slaan."),
    );

    // Google
    if (googleClientId) {
      const gWrap = el("div", { class: "g-btn-wrap" });
      card.append(gWrap, el("div", { class: "auth-divider" }, el("span", {}, "of met e-mail")));
      mountGoogle(gWrap, googleClientId, onAuthed);
    }

    // email/password form
    const email = el("input", { type: "email", placeholder: "jij@voorbeeld.nl", autocomplete: "email" });
    const pw = el("input", { type: "password", placeholder: "Wachtwoord", autocomplete: mode === "login" ? "current-password" : "new-password" });
    const nameField = mode === "register"
      ? el("label", { class: "field" }, [el("span", { class: "field-label" }, "Naam (optioneel)"), el("input", { type: "text", placeholder: "Je naam", id: "auth-name" })])
      : null;

    const submit = el("button", { class: "btn primary auth-submit" }, mode === "login" ? "Inloggen" : "Account aanmaken");
    const form = el("form", { class: "auth-form" }, [
      el("label", { class: "field" }, [el("span", { class: "field-label" }, "E-mail"), email]),
      el("label", { class: "field" }, [el("span", { class: "field-label" }, "Wachtwoord"), pw]),
      nameField,
      submit,
    ]);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const res = mode === "login"
          ? await auth.login(email.value.trim(), pw.value)
          : await auth.register(email.value.trim(), pw.value, (document.getElementById("auth-name") || {}).value);
        onAuthed(res.user);
      } catch (err) {
        toast(err.message, "err");
        submit.disabled = false;
      }
    });
    card.append(form);

    card.append(el("div", { class: "auth-switch" }, [
      mode === "login" ? "Nog geen account? " : "Al een account? ",
      el("a", { href: "#", onclick: (e) => { e.preventDefault(); mode = mode === "login" ? "register" : "login"; render(); } },
        mode === "login" ? "Maak er een" : "Log in"),
    ]));
  }

  render();
}

function mountGoogle(wrap, clientId, onAuthed) {
  const init = () => {
    /* global google */
    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp) => {
        try { const r = await auth.google(resp.credential); onAuthed(r.user); }
        catch (e) { toast(e.message, "err"); }
      },
    });
    google.accounts.id.renderButton(wrap, { theme: "outline", size: "large", width: 320, text: "continue_with", shape: "pill" });
  };
  if (window.google && google.accounts) return init();
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.async = true; s.defer = true;
  s.onload = init;
  document.head.append(s);
}
