{
  description = "T3 Code - A harness for coding agents";

  # ===== MAINTENANCE NOTES FOR MAINTAINERS =====
  # To update to a new release:
  #   1. Update `releaseTag` below (e.g., "v0.0.24")
  #   2. Update `appimageHash` by running: nix hash url <download-url>
  #   3. Optionally update `supportedSystems` if architecture support changes
  # ==============================================

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.05";
  };

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;

      # ----- RELEASES -----
      # Update this to the new version when a new release is published
      # Format: "vX.Y.Z" (must match the GitHub release tag)
      releaseTag = "v0.0.23";

      # ----- DOWNLOAD -----
      # Update this hash when the AppImage URL changes
      # Run: nix hash url https://github.com/pingdotgg/t3code/releases/download/v0.0.23/T3-Code-0.0.23-x86_64.AppImage
      appimageHash = "sha256-qMPSxQuiCwLT0As1foSDqaKoNMoLrjbKbDSwQW56T7g=";

      # ----- PLATFORMS -----
      # Currently only x86_64-linux is supported (no ARM AppImage available)
      supportedSystems = [ "x86_64-linux" ];

      # ----- DERIVATION -----
      pkgs = import nixpkgs { system = "x86_64-linux"; };
      version = lib.removePrefix "v" releaseTag;

      appimage = pkgs.fetchurl {
        url = "https://github.com/pingdotgg/t3code/releases/download/${releaseTag}/T3-Code-${version}-x86_64.AppImage";
        sha256 = appimageHash;
      };
    in
    {
      packages.x86_64-linux = pkgs.stdenv.mkDerivation {
        pname = "t3code";
        inherit version;

        src = appimage;

        dontStrip = true;
        dontUnpack = true;

        installPhase = ''
          mkdir -p $out/bin
          cp $src $out/bin/t3code.AppImage
          chmod +x $out/bin/t3code.AppImage

          # Launcher: uses appimage-run to execute the AppImage
          cat > $out/bin/t3code << 'LAUNCHER'
          #!/bin/sh
          exec appimage-run "$(dirname "$0")/t3code.AppImage" "$@"
          LAUNCHER
          chmod +x $out/bin/t3code
        '';

        meta = {
          description = "T3 Code - A harness for coding agents";
          homepage = "https://t3.codes";
          license = pkgs.lib.licenses.mit;
          platforms = supportedSystems;
        };
      };

      defaultPackage = self.packages.x86_64-linux;
    };
}
