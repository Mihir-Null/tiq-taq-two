# NixOS module for the lobby server.
#
#   # flake.nix of your system:
#   inputs.tiq-taq-two.url = "github:Mihir-Null/tiq-taq-two";
#   modules = [ inputs.tiq-taq-two.nixosModules.default {
#     services.tiq-taq-two = {
#       enable = true;
#       port = 8787;
#       allowedOrigins = [ "https://you.github.io" ];   # if the app is hosted elsewhere
#     };
#   } ];
#
# Put a reverse proxy with TLS in front (Caddy/nginx), e.g.
#   services.caddy.virtualHosts."tiq.example.com".extraConfig = "reverse_proxy 127.0.0.1:8787";
self:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.tiq-taq-two;
in
{
  options.services.tiq-taq-two = {
    enable = lib.mkEnableOption "the Tiq Taq Two lobby server";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "tiq-taq-two.packages.\${system}.default";
      description = "The built tiq-taq-two package.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address to listen on (use 0.0.0.0 without a reverse proxy).";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8787;
      description = "TCP port for HTTP + WebSockets.";
    };

    serverName = lib.mkOption {
      type = lib.types.str;
      default = "Tiq Taq Two lobby";
      description = "Name shown to players in the lobby.";
    };

    allowedOrigins = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "*" ];
      description = "Web origins allowed to use the API/WebSocket (e.g. your GitHub Pages URL).";
    };

    maxRooms = lib.mkOption {
      type = lib.types.int;
      default = 300;
      description = "Maximum number of simultaneous rooms.";
    };

    behindProxy = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Trust X-Forwarded-For (set when a reverse proxy sits in front).";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open the port in the firewall.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.tiq-taq-two = {
      description = "Tiq Taq Two lobby server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      environment = {
        HOST = cfg.host;
        PORT = toString cfg.port;
        SERVER_NAME = cfg.serverName;
        ALLOWED_ORIGINS = lib.concatStringsSep "," cfg.allowedOrigins;
        MAX_ROOMS = toString cfg.maxRooms;
        TRUST_PROXY = if cfg.behindProxy then "1" else "0";
      };
      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        Restart = "on-failure";
        RestartSec = 3;
        DynamicUser = true;
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictSUIDSGID = true;
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = false; # V8's JIT needs W^X exceptions
        CapabilityBoundingSet = "";
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
