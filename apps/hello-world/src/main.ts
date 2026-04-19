import "./style.css";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app root");
}

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">Forma Design Extensions</p>
    <h1>Hello World</h1>
    <p class="copy">
      This is a minimal second app in the monorepo. It exists to show how each extension
      gets its own folder, package, scripts, and deploy path.
    </p>
    <ul class="facts">
      <li>Package: <code>@hesam/hello-world</code></li>
      <li>Source path: <code>apps/hello-world</code></li>
      <li>Deploy path: <code>/forma-design-extensions/hello-world/</code></li>
    </ul>
  </main>
`;
