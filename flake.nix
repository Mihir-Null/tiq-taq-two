{
  description = "Tiq Taq Two — quantum tic-tac-toe with online lobbies";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # `nix develop` → a shell with Node for `npm run dev` / `npm run server`.
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 ];
          shellHook = ''echo "tiq-taq-two dev shell — node $(node --version). Try: npm install && npm run dev"'';
        };
      });

      # `nix build` → the built web app + a `tiq-taq-two-server` launcher.
      packages = forAll (pkgs: { default = pkgs.callPackage ./nix/package.nix { }; });

      # NixOS: imports = [ tiq-taq-two.nixosModules.default ];
      #        services.tiq-taq-two.enable = true;
      nixosModules.default = import ./nix/module.nix self;
    };
}
