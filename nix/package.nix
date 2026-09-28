# Builds the web app and wraps the lobby server.
#
# First build: `nix build` will fail and print the real `npmDepsHash` —
# paste it below (this is the normal Nix workflow for npm projects), then
# build again. Update it whenever package-lock.json changes.
{ lib, buildNpmPackage, nodejs_22, makeWrapper }:

buildNpmPackage {
  pname = "tiq-taq-two";
  version = "1.0.0";
  src = lib.cleanSource ../.;
  nodejs = nodejs_22;

  npmDepsHash = lib.fakeHash;

  nativeBuildInputs = [ makeWrapper ];

  # `npm run build` = type-check + vite build → dist/
  npmBuildScript = "build";
  # Run the unit tests during the build (engine, bot, room protocol).
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    npm prune --omit=dev --no-audit --no-fund
    app=$out/lib/tiq-taq-two
    mkdir -p $app $out/bin
    cp -r dist server src package.json node_modules $app/
    # Node >= 22.18 runs the TypeScript server directly (type stripping).
    makeWrapper ${nodejs_22}/bin/node $out/bin/tiq-taq-two-server \
      --add-flags $app/server/main.ts \
      --set-default STATIC_DIR $app/dist
    runHook postInstall
  '';

  meta = {
    description = "Quantum tic-tac-toe: superposition, entanglement and interference, with lobbies";
    license = lib.licenses.mit;
    mainProgram = "tiq-taq-two-server";
  };
}
