package com.logexplorer;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class LogExplorerApplication {

  public static void main(String[] args) {
    SpringApplication.run(LogExplorerApplication.class, args);
  }
}
