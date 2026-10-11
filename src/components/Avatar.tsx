/** Round profile picture, or initials when there isn't one. */
export default function Avatar({ url, name, size = 40 }: { url: string | null | undefined; name: string; size?: number }) {
  const initials =
    name
      .split(/[\s_.@-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span className="avatar-badge" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {url ? <img src={url} alt="" width={size} height={size} /> : initials}
    </span>
  );
}
