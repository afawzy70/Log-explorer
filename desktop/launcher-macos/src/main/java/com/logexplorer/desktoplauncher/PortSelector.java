package com.logexplorer.desktoplauncher;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;

/**
 * REL-1 (mirrors desktop/launcher/PortSelector.cs): 3434 is preferred but
 * never assumed free. Falls back to an OS-assigned free loopback port -
 * never a predictable scan across a range.
 */
final class PortSelector {

    static final int PREFERRED_PORT = 3434;

    private PortSelector() {
    }

    static int selectPort() {
        if (tryBindLoopback(PREFERRED_PORT)) {
            return PREFERRED_PORT;
        }
        try (ServerSocket socket = new ServerSocket(0, 0, InetAddress.getLoopbackAddress())) {
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException("Could not obtain any free loopback port from the OS.", e);
        }
    }

    private static boolean tryBindLoopback(int port) {
        try (ServerSocket socket = new ServerSocket(port, 0, InetAddress.getLoopbackAddress())) {
            return true;
        } catch (IOException e) {
            return false;
        }
    }
}
