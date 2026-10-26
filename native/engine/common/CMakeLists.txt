enable_language(C ASM)
set(DEVELOPMENT_TEAM    ""  CACHE STRING "APPLE Developtment Team")
set(RES_DIR             ""  CACHE STRING "Resource path")
set(COCOS_X_PATH        ""  CACHE STRING "Path to engine/native/")

set(TARGET_OSX_VERSION "10.14" CACHE STRING "Target MacOSX version" FORCE)
set(TARGET_IOS_VERSION "11.0"  CACHE STRING "Target iOS version" FORCE)

set(CMAKE_CXX_STANDARD 17)
option(CC_DEBUG_FORCE           "Force enable CC_DEBUG in release mode" OFF)
option(USE_SE_V8                "Use V8 JavaScript Engine"              ON)
option(USE_V8_DEBUGGER          "Compile v8 inspector ws server"        ON)
option(USE_V8_DEBUGGER_FORCE    "Force enable debugger in release mode" OFF)
option(USE_SOCKET               "Enable WebSocket & SocketIO"           ON)
option(USE_AUDIO                "Enable Audio"                          ON)     #Enable AudioEngine
option(USE_EDIT_BOX             "Enable EditBox"                        ON)
option(USE_SE_JSC               "Use JavaScriptCore on MacOSX/iOS"      OFF)
option(USE_VIDEO                "Enable VideoPlayer Component"          ON)
option(USE_WEBVIEW              "Enable WebView Component"              ON)
option(USE_MIDDLEWARE           "Enable Middleware"                     ON)
option(USE_DRAGONBONES          "Enable Dragonbones"                    ON)
option(USE_SPINE                "Enable Spine"                          ON)
option(USE_WEBSOCKET_SERVER     "Enable WebSocket Server"               OFF)
option(USE_JOB_SYSTEM_TASKFLOW  "Use taskflow as job system backend"    OFF)
option(USE_JOB_SYSTEM_TBB       "Use tbb as job system backend"         OFF)
option(USE_PHYSICS_PHYSX        "Use PhysX Physics"                     ON)
option(USE_OCCLUSION_QUERY      "Use Occlusion Query"                   ON)
option(USE_DEBUG_RENDERER       "Use Debug Renderer"                    ON)
option(USE_GEOMETRY_RENDERER    "Use Geometry Renderer"                 ON)
option(USE_WEBP                 "Use Webp"                              ON)

if(NOT RES_DIR)
    message(FATAL_ERROR "RES_DIR is not set!")
endif()

include(${RES_DIR}/proj/cfg.cmake)

if(EXISTS ${CMAKE_CURRENT_LIST_DIR}/localCfg.cmake)
    include(${CMAKE_CURRENT_LIST_DIR}/localCfg.cmake)
endif()

if(NOT COCOS_X_PATH)
    message(FATAL_ERROR "COCOS_X_PATH is not set!")
endif()

if(USE_XR OR USE_AR_MODULE)
    include(${CMAKE_CURRENT_LIST_DIR}/xr.cmake)
endif()

include(${COCOS_X_PATH}/CMakeLists.txt)

# The engine decodes WebP pictures with premultiplied alpha (MODE_rgbA) but sprites blend them as
# straight alpha: every soft edge is darkened twice, a dark jagged ring around items, bags and
# icons on Android (the web decodes them right). Build a copy of Image.cpp that decodes straight
# RGBA instead; the Cocos install stays untouched.
set(EF_IMAGE_CPP ${CMAKE_BINARY_DIR}/ef-patched/platform/Image.cpp)
file(READ ${COCOS_X_PATH}/cocos/platform/Image.cpp EF_IMAGE_SRC)
string(REPLACE "MODE_rgbA : MODE_RGB" "MODE_RGBA : MODE_RGB" EF_IMAGE_SRC "${EF_IMAGE_SRC}")
string(REPLACE "#include \"Image.h\"" "#include \"platform/Image.h\"" EF_IMAGE_SRC "${EF_IMAGE_SRC}")
if(EXISTS ${EF_IMAGE_CPP})
    file(READ ${EF_IMAGE_CPP} EF_IMAGE_OLD)
endif()
if(NOT "${EF_IMAGE_SRC}" STREQUAL "${EF_IMAGE_OLD}")
    file(WRITE ${EF_IMAGE_CPP} "${EF_IMAGE_SRC}")
endif()
get_target_property(EF_ENGINE_SOURCES cocos_engine SOURCES)
list(TRANSFORM EF_ENGINE_SOURCES REPLACE ".*cocos/platform/Image\\.cpp$" ${EF_IMAGE_CPP})
set_target_properties(cocos_engine PROPERTIES SOURCES "${EF_ENGINE_SOURCES}")

list(APPEND CC_COMMON_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/Classes/Game.h
    ${CMAKE_CURRENT_LIST_DIR}/Classes/Game.cpp
)
