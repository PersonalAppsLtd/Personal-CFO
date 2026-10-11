import { useRef, useState } from "react";
import { useApp } from "../lib/data";
import { supabase } from "../supabase";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 2 * 1024 * 1024;
// Same rule as Personal CEO
const USERNAME_PATTERN = /^[A-Za-z0-9_.]{3,30}$/;

function initials(name: string | null | undefined, email: string | undefined): string {
  const source = name?.trim() || email || "?";
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export default function PersonalDetails() {
  const { profile, session, updateProfile } = useApp();
  const userId = session.user.id;
  const [username, setUsername] = useState(profile?.username ?? "");
  const [name, setName] = useState(profile?.display_name ?? "");
  const [company, setCompany] = useState(profile?.company ?? "");
  const [dob, setDob] = useState(profile?.date_of_birth ?? "");
  const [jobTitle, setJobTitle] = useState(profile?.job_title ?? "");
  const [email, setEmail] = useState(session.user.email ?? "");
  const pendingEmail = session.user.new_email;
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    const handle = username.trim();
    if (handle && !USERNAME_PATTERN.test(handle)) {
      setMessage("Usernames are 3–30 characters: letters, numbers, dots and underscores.");
      return;
    }
    if (dob && dob > today) {
      setMessage("Date of birth can't be in the future.");
      return;
    }
    const err = await updateProfile({
      username: handle || null,
      display_name: name.trim() || null,
      date_of_birth: dob || null,
      company: company.trim() || null,
      job_title: jobTitle.trim() || null,
    });
    if (err) {
      setMessage(/profiles_username_unique|duplicate key/.test(err) ? "That username is already taken." : err);
      return;
    }

    // Changing the sign-in email needs confirming from the inbox before it takes effect
    const newEmail = email.trim().toLowerCase();
    if (newEmail && newEmail !== (session.user.email ?? "").toLowerCase()) {
      const { error } = await supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo: `${window.location.origin}/settings` });
      setMessage(error ? error.message : `Saved. We've sent a link to ${newEmail}: open it to finish changing your email.`);
      return;
    }
    setMessage("Saved.");
  }

  // Replace everything in the user's folder so old pictures don't pile up
  async function clearOldPictures(keep?: string) {
    const { data } = await supabase.storage.from("avatars").list(userId);
    const old = (data ?? []).map((f) => `${userId}/${f.name}`).filter((path) => path !== keep);
    if (old.length) await supabase.storage.from("avatars").remove(old);
  }

  async function upload(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) {
      setMessage("Please choose a PNG, JPEG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage("Please choose an image under 2 MB.");
      return;
    }
    setUploading(true);
    setMessage(null);
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
    if (error) {
      setUploading(false);
      setMessage(error.message);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const err = await updateProfile({ avatar_url: data.publicUrl });
    await clearOldPictures(path);
    setUploading(false);
    setMessage(err ?? "Picture updated.");
  }

  async function removePicture() {
    await clearOldPictures();
    const err = await updateProfile({ avatar_url: null });
    setMessage(err ?? "Picture removed.");
  }

  return (
    <section className="card stack">
      <h2>Personal details</h2>
      <div className="avatar-row">
        {profile?.avatar_url ? (
          <img className="avatar" src={profile.avatar_url} alt="Your profile picture" />
        ) : (
          <div className="avatar avatar-initials" aria-hidden>{initials(profile?.display_name || profile?.username, session.user.email)}</div>
        )}
        <div className="row-wrap">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : profile?.avatar_url ? "Change picture" : "Add picture"}
          </button>
          {profile?.avatar_url && (
            <button type="button" className="link danger" onClick={removePicture} disabled={uploading}>Remove</button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload(file);
          }}
        />
      </div>
      <label>
        Username
        <input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Full name
        <input type="text" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Date of birth
        <input type="date" autoComplete="bday" min="1900-01-01" max={today} value={dob} onChange={(e) => setDob(e.target.value)} />
      </label>
      <label>
        Email address
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {pendingEmail && <p className="muted small">Waiting for you to confirm the change to {pendingEmail}.</p>}
      <label>
        Company name
        <input type="text" autoComplete="organization" maxLength={120} value={company} onChange={(e) => setCompany(e.target.value)} />
      </label>
      <label>
        Job title
        <input type="text" autoComplete="organization-title" maxLength={100} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </label>
      <div className="row-end">
        {message && <span className="muted small">{message}</span>}
        <button className="primary" onClick={save}>Save</button>
      </div>
    </section>
  );
}
