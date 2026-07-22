"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Eye, EyeOff } from "lucide-react";
import { motion } from "motion/react";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields.");
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
            Welcome back
          </h1>
          <p style={{ fontSize: "0.9375rem", color: "#6B6B67", lineHeight: 1.55 }}>
            Sign in to continue your conversation.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label
              style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "#2C2C29", marginBottom: "7px" }}
            >
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              style={inputBase}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label style={{ fontSize: "0.875rem", fontWeight: 500, color: "#2C2C29" }}>
                Password
              </label>
              <button
                type="button"
                style={{ fontSize: "0.8125rem", color: "#4A4A47", fontWeight: 500, background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#111110")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#4A4A47")}
              >
                Forgot password?
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{ ...inputBase, paddingRight: "46px" }}
                onFocus={onFocus}
                onBlur={onBlur}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: "absolute",
                  right: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#6B6B67",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "28px",
                  minHeight: "28px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#111110")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#6B6B67")}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p style={{ fontSize: "0.875rem", color: "#C0392B", marginTop: "-4px" }}>{error}</p>
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
                Signing in…
              </span>
            ) : "Sign in"}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px" style={{ background: "#E8E8E5" }} />
          <span style={{ fontSize: "0.8125rem", color: "#6B6B67" }}>or</span>
          <div className="flex-1 h-px" style={{ background: "#E8E8E5" }} />
        </div>

        {/* Signup link */}
        <p className="text-center" style={{ fontSize: "0.9375rem", color: "#6B6B67" }}>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            style={{ color: "#111110", fontWeight: 600, textDecoration: "none" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "none")}
          >
            Create one
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
