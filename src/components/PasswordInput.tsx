"use client";
import { useState } from "react";
import { EyeIcon } from "./Eye";

/** A password field with an eye button that shows or hides what was typed. */
export default function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input {...props} type={show ? "text" : "password"} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        className="pw-eye"
        onClick={() => setShow(!show)}
        aria-label={show ? "Hide passphrase" : "Show passphrase"}
        aria-pressed={show}
        title={show ? "Hide" : "Show"}
      >
        <EyeIcon off={show} />
      </button>
    </span>
  );
}
