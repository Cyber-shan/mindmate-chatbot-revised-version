"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Eye, EyeOff, Check } from "lucide-react";
import { motion } from "motion/react";

export default function Signup() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password || !form.confirm) {
      setError("Please fill in all fields.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (!agreed) {
      setError("Please accept the terms to continue.");
      return;
    }
    setError("");
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      router.push("/chat");
    }, 900);
  };

  const inputBase: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1.5px solid #E0E0DC",
    background: "#F8F8F6",
    fontSize: "1rem",
    color: "#111110",
    outline: "none",
    transition: "border-color 0.15s ease, background 0.15s ease",
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    WebkitAppearance: "none",
  };

  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "#111110";
    e.currentTarget.style.background = "#FFFFFF";
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "#E0E0DC";
    e.currentTarget.style.background = "#F8F8F6";
  };

  const passwordsMatch = form.confirm.length > 0 && form.password === form.confirm;

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-5 py-12"
      style={{ background: "#FFFFFF", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", WebkitFontSmoothing: "antialiased" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full"
        style={{ maxWidth: "400px" }}
      >
        {/* Brand */}
        <div className="flex flex-col items-center mb-10">
          <div
            className="w-11 h-11 flex items-center justify-center rounded-2xl mb-4"
            style={{ background: "#111110" }}
          >
            <Bot size={20} className="text-white" />
          </div>
          <span
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontWeight: 600,
              fontSize: "1.125rem",
              color: "#111110",
              letterSpacing: "-0.02em",
            }}
          >
            Chatbot
          </span>
        </div>

        {/* Heading */}
        <div className="mb-7">
          <h1
            style={{
              fontWeight: 700,
              fontSize: "1.625rem",
              color: "#111110",
              letterSpacing: "-0.03em",
              lineHeight: 1.2,
              marginBottom: "0.45rem",
            }}
          >
            Create an account
          </h1>
          <p style={{ fontSize: "0.9375rem", color: "#6B6B67", lineHeight: 1.55 }}>
            Begin your wellness journey today.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Full name */}
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "#2C2C29", marginBottom: "7px" }}>
              Full name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={set("name")}
              placeholder="Alex Johnson"
              autoComplete="name"
              style={inputBase}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>

          {/* Email */}
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "#2C2C29", marginBottom: "7px" }}>
              Email address
            </label>
            <input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="you@example.com"
              autoComplete="email"
              style={inputBase}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "#2C2C29", marginBottom: "7px" }}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={set("password")}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                style={{ ...inputBase, paddingRight: "46px" }}
                onFocus={onFocus}
                onBlur={onBlur}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)",
                  color: "#6B6B67", background: "none", border: "none", cursor: "pointer",
                  padding: "4px", display: "flex", alignItems: "center", minWidth: "28px", minHeight: "28px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#111110")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#6B6B67")}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "#2C2C29", marginBottom: "7px" }}>
              Confirm password
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showConfirm ? "text" : "password"}
                value={form.confirm}
                onChange={set("confirm")}
                placeholder="Repeat your password"
                autoComplete="new-password"
                style={{
                  ...inputBase,
                  paddingRight: "46px",
                  ...(passwordsMatch ? { borderColor: "#2D7A4F", background: "#F6FAF7" } : {}),
                }}
                onFocus={(e) => {
                  if (!passwordsMatch) onFocus(e);
                }}
                onBlur={(e) => {
                  if (!passwordsMatch) onBlur(e);
                }}
              />
              {/* Match checkmark */}
              {passwordsMatch && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  style={{
                    position: "absolute", right: "42px", top: "50%", transform: "translateY(-50%)",
                    display: "flex", alignItems: "center",
                  }}
                >
                  <Check size={14} style={{ color: "#2D7A4F" }} />
                </motion.div>
              )}
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                style={{
                  position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)",
                  color: "#6B6B67", background: "none", border: "none", cursor: "pointer",
                  padding: "4px", display: "flex", alignItems: "center", minWidth: "28px", minHeight: "28px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#111110")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#6B6B67")}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Terms checkbox */}
          <div className="flex items-start gap-3 pt-1">
            <button
              type="button"
              onClick={() => setAgreed((v) => !v)}
              className="flex-shrink-0 flex items-center justify-center rounded transition-all"
              style={{
                width: "18px",
                height: "18px",
                marginTop: "2px",
                border: agreed ? "none" : "1.5px solid #CACAC6",
                background: agreed ? "#111110" : "transparent",
                cursor: "pointer",
              }}
            >
              {agreed && <Check size={11} className="text-white" />}
            </button>
            <p style={{ fontSize: "0.875rem", color: "#6B6B67", lineHeight: 1.55 }}>
              I agree to the{" "}
              <span style={{ color: "#111110", fontWeight: 500, cursor: "pointer", textDecorationLine: "underline" }}>
                Terms of Service
              </span>{" "}
              and{" "}
              <span style={{ color: "#111110", fontWeight: 500, cursor: "pointer", textDecorationLine: "underline" }}>
                Privacy Policy
              </span>
            </p>
          </div>

          {/* Error */}
          {error && (
            <p style={{ fontSize: "0.875rem", color: "#C0392B" }}>{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center rounded-xl active:scale-[0.98] transition-transform"
            style={{
              background: loading ? "#3A3A38" : "#111110",
              color: "#FFFFFF",
              padding: "13px 16px",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              border: "none",
              letterSpacing: "-0.01em",
              marginTop: "4px",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#2A2A28"; }}
            onMouseLeave={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#111110"; }}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <motion.span
                  className="block rounded-full border-2"
                  style={{ width: "16px", height: "16px", borderColor: "rgba(255,255,255,0.25)", borderTopColor: "#FFFFFF", flexShrink: 0 }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.75, repeat: Infinity, ease: "linear" }}
                />
                Creating account…
              </span>
            ) : "Create account"}
          </button>
        </form>

        {/* Sign in link */}
        <p className="text-center mt-7" style={{ fontSize: "0.9375rem", color: "#6B6B67" }}>
          Already have an account?{" "}
          <Link
            href="/"
            style={{ color: "#111110", fontWeight: 600, textDecoration: "none" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "none")}
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
