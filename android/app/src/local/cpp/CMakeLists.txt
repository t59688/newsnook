cmake_minimum_required(VERSION 3.22.1)
project(newsnook_bergamot)

# 仅 ARM64：消费级真机主路径；Bergamot/Marian 在模拟器 x86 上常因指令集踩坑。
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(ENABLE_BERGAMOT "Enable Bergamot offline translation engine" ON)

set(BERGAMOT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/third_party/bergamot-translator")
set(HAS_BERGAMOT OFF)
if (ENABLE_BERGAMOT AND EXISTS "${BERGAMOT_ROOT}/CMakeLists.txt")
  set(HAS_BERGAMOT ON)
endif()

if (ANDROID)
  # cpuinfo / ruy 在 Android NDK 下偶发 FindThreads 误判；
  # bionic 自带 pthread，这里显式喂给下游 CMake。
  set(CMAKE_REQUIRED_INCLUDES
    "${CMAKE_SYSROOT}/usr/include"
    "${CMAKE_SYSROOT}/usr/include/${CMAKE_ANDROID_ARCH_TRIPLE}"
  )
  set(CMAKE_THREAD_LIBS_INIT "" CACHE STRING "" FORCE)
  set(CMAKE_HAVE_THREADS_LIBRARY 1 CACHE BOOL "" FORCE)
  set(CMAKE_USE_PTHREADS_INIT 1 CACHE BOOL "" FORCE)
  set(THREADS_PREFER_PTHREAD_FLAG TRUE CACHE BOOL "" FORCE)
  set(Threads_FOUND TRUE CACHE BOOL "" FORCE)
endif()

add_library(bergamot_jni SHARED bergamot_jni.cpp)
if (ANDROID)
  target_link_options(bergamot_jni PRIVATE
    "-Wl,-z,max-page-size=16384"
    "-Wl,-z,common-page-size=16384")
endif()

if (HAS_BERGAMOT)
  message(STATUS "Bergamot third_party found — linking real engine")
  set(COMPILE_CUDA OFF CACHE BOOL "" FORCE)
  set(USE_RUY_SGEMM ON CACHE BOOL "" FORCE)
  set(SSPLIT_USE_INTERNAL_PCRE2 ON CACHE BOOL "" FORCE)
  set(COMPILE_LIBRARY_ONLY ON CACHE BOOL "" FORCE)
  set(USE_WASM_COMPATIBLE_SOURCES OFF CACHE BOOL "" FORCE)
  add_subdirectory("${BERGAMOT_ROOT}" bergamot_build EXCLUDE_FROM_ALL)

  target_sources(bergamot_jni PRIVATE bergamot_engine_service.cpp)
  target_compile_definitions(bergamot_jni PRIVATE HAS_BERGAMOT=1)
  target_include_directories(bergamot_jni PRIVATE
    "${BERGAMOT_ROOT}/src"
    "${BERGAMOT_ROOT}/3rd_party"
  )
  # 目标名随 bergamot-translator 版本可能是 bergamot-translator / bergamot_translator
  if (TARGET bergamot-translator)
    target_link_libraries(bergamot_jni bergamot-translator)
  elseif (TARGET bergamot_translator)
    target_link_libraries(bergamot_jni bergamot_translator)
  else()
    message(FATAL_ERROR "bergamot-translator CMake target not found")
  endif()
else()
  message(STATUS "Bergamot third_party missing — building stub engine")
  target_sources(bergamot_jni PRIVATE bergamot_engine_stub.cpp)
endif()

find_library(log-lib log)
target_link_libraries(bergamot_jni android ${log-lib} c++_shared)
