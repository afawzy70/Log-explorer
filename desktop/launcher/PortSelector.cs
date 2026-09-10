using System.Net;
using System.Net.Sockets;

namespace LogExplorer.Launcher;

/// <summary>
/// Legacy Remediation Slice 9 §B/§C: 3434 is preferred but never assumed
/// free. This is only ever called after <see cref="SingleInstanceGuard"/>
/// has already confirmed this is the one true Log Explorer instance, so a
/// bind failure on the preferred port here means an unrelated process
/// owns it, not another Log Explorer - no port-based identity check is
/// layered on top of the mutex-based one in <see cref="SingleInstanceGuard"/>.
/// </summary>
internal static class PortSelector
{
    public const int PreferredPort = 3434;

    /// <summary>
    /// Returns 3434 if free; otherwise an OS-assigned free loopback port
    /// (never a predictable scan across a range - the mission's own
    /// explicit "do not create an unsafe predictable scan" instruction).
    /// There is an inherent, small TOCTOU race between this probe and the
    /// backend actually binding the port a moment later - the same
    /// unavoidable race any "ask the OS for a free port" approach has
    /// (including Spring Boot's own <c>server.port=0</c>) - acceptable
    /// here since a bind failure on startup fails loudly rather than
    /// silently.
    /// </summary>
    public static int SelectPort()
    {
        if (TryBindLoopback(PreferredPort))
        {
            return PreferredPort;
        }

        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static bool TryBindLoopback(int port)
    {
        try
        {
            using var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            listener.Stop();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }
}
