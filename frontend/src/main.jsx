import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./components/AuthGate.jsx";
// Inter is bundled with the app (no request to Google, works offline).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);
