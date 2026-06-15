import { el, toast } from "./util.js";
import { auth } from "./auth.js";
import { t } from "./i18n.js";

// translate a server error via its code, falling back to the raw message
function authErr(e) {
  const k = e && e.code ? "err." + e.code : null;
  const tr = k ? t(k) : null;
  return tr && tr !== k ? tr : (e && e.message) || "Error";
}

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
      el("h1", { class: "auth-title" }, mode === "login" ? t("login.signin") : t("login.create")),
      el("p", { class: "auth-sub" }, mode === "login" ? t("login.welcomeBack") : t("login.createSub")),
    );

    // Google
    if (googleClientId) {
      const gWrap = el("div", { class: "g-btn-wrap" });
      card.append(gWrap, el("div", { class: "auth-divider" }, el("span", {}, t("login.orEmail"))));
      mountGoogle(gWrap, googleClientId, onAuthed);
    }

    // email/password form
    const email = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email" });
    const pw = el("input", { type: "password", placeholder: t("login.password"), autocomplete: mode === "login" ? "current-password" : "new-password" });
    const nameField = mode === "register"
      ? el("label", { class: "field" }, [el("span", { class: "field-label" }, t("login.nameOptional")), el("input", { type: "text", placeholder: t("login.namePlaceholder"), id: "auth-name" })])
      : null;

    const submit = el("button", { class: "btn primary auth-submit" }, mode === "login" ? t("login.signin") : t("login.create"));
    const form = el("form", { class: "auth-form" }, [
      el("label", { class: "field" }, [el("span", { class: "field-label" }, t("profile.email")), email]),
      el("label", { class: "field" }, [el("span", { class: "field-label" }, t("login.password")), pw]),
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
        toast(authErr(err), "err");
        submit.disabled = false;
      }
    });
    card.append(form);

    card.append(el("div", { class: "auth-switch" }, [
      mode === "login" ? t("login.noAccount") : t("login.haveAccount"),
      el("a", { href: "#", onclick: (e) => { e.preventDefault(); mode = mode === "login" ? "register" : "login"; render(); } },
        mode === "login" ? t("login.makeOne") : t("login.doLogin")),
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
        catch (e) { toast(authErr(e), "err"); }
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
