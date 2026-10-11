import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { USERNAME_HINT, USERNAME_PATTERN } from "../lib/money";

export default function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const handle = username.trim();
    if (mode === "signup") {
      if (!USERNAME_PATTERN.test(handle)) return setMessage(`Usernames are ${USERNAME_HINT.toLowerCase()}`);
      setBusy(true);
      const { data: free } = await supabase.rpc("username_available", { p_username: handle });
      if (free === false) {
        setBusy(false);
        return setMessage("That username is already taken. Try another.");
      }
    }
    setBusy(true);
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin, data: { username: handle } },
          });
    setBusy(false);
    if (error) setMessage(error.message);
    else if (mode === "signup" && !data.session) setMessage("Check your email to confirm your account, then sign in.");
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <h1>Personal CFO</h1>
        <p className="lede">
          Card and contactless make money feel invisible. Personal CFO shows your spending money like cash in a
          wallet, so you can watch it go down, and rewards you for saving and investing.
        </p>
        <form onSubmit={submit} className="stack">
          {mode === "signup" && (
            <label>
              Username
              <input
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={30}
                placeholder="e.g. liam"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <span className="muted small block">{USERNAME_HINT} Friends use it to find you.</span>
            </label>
          )}
          <label>
            Email
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        {message && <p className="notice">{message}</p>}
        <button className="link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
